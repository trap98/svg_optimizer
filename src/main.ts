import "./style.css";
import JSZip from "jszip";
import type { SvgAnalysis } from "./analysis";
import { PLUGIN_DEFS } from "./plugins";
import {
  DEFAULT_GLOBAL_OPTIONS,
  type GlobalOptions,
  type PluginState,
  getDefaultStates,
  loadGlobalOptions,
  loadPluginStates,
  savePluginStates,
  saveGlobalOptions,
} from "./settings";
import { formatBytes, type OptimizeResult } from "./optimizer";
import {
  createPreset,
  exportPresetsToJson,
  importPresetsFromJson,
  loadPresets,
  savePresets,
  type Preset,
} from "./presets";
import type { AnalyzeWorkerResponse, OptimizeWorkerResponse, WorkerResponse } from "./worker";

type AnalysisSource = "original" | "optimized";

interface AnalysisCacheEntry {
  svg: string | null;
  result: SvgAnalysis | null;
}

// ─── Worker setup ───────────────────────────────────────────────────────────
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let nextWorkerRequestId = 0;
let pendingOptimizeRequestId = 0;
const pendingAnalysisRequests = new Map<number, { target: AnalysisSource; svg: string }>();
const pendingAnalysisRequestBySource: Record<AnalysisSource, number | null> = {
  original: null,
  optimized: null,
};
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  if (e.data.kind === "analyze") {
    handleAnalysisResponse(e.data);
    return;
  }

  // Batch response: always handle regardless of pendingOptimizeRequestId
  const batchIdx = batchRequestMap.get(e.data.id);
  if (batchIdx !== undefined) {
    batchRequestMap.delete(e.data.id);
    handleBatchResponse(batchIdx, e.data);
    return;
  }

  if (e.data.id !== pendingOptimizeRequestId) return;

  pendingOptimizeRequestId = 0;
  setLoading(false);

  if (!e.data.success) {
    setAnalysisPlaceholder("optimized", "Impossible d'analyser la version optimisée tant que l'optimisation échoue.");
    showToast("Erreur lors de l'optimisation. Le SVG est peut-être invalide.");
    return;
  }

  applyOptimizationResult(e.data.result);
};

function applyOptimizationResult(result: OptimizeResult): void {
  optimizedSvg = result.data;
  optimizedSvgStale = false;
  invalidateAnalysisCache("optimized");

  document.getElementById("stat-original")!.textContent = formatBytes(result.originalSize);
  document.getElementById("stat-optimized")!.textContent = formatBytes(result.optimizedSize);
  const savingsEl = document.getElementById("stat-savings")!;
  savingsEl.textContent =
    result.savings >= 0 ? `−${result.savings}%` : `+${Math.abs(result.savings)}%`;
  statSavings.classList.toggle("negative", result.savings < 0);

  svgDisplayOptimized.innerHTML =
    result.data + '<div class="loading-spinner"><div class="spinner-ring"></div></div>';
  codeOptimized.textContent = result.data;

  btnCopy.disabled = false;
  btnDownload.disabled = false;

  refreshAllAnalysisViews();
}

worker.onerror = () => {
  if (pendingOptimizeRequestId > 0) {
    pendingOptimizeRequestId = 0;
    setLoading(false);
    setAnalysisPlaceholder("optimized", "Impossible d'analyser la version optimisée tant que l'optimisation échoue.");
    showToast("Erreur interne du worker d'optimisation.");
  }
  if (pendingAnalysisRequests.size > 0) {
    for (const { target } of pendingAnalysisRequests.values()) {
      setAnalysisPlaceholder(target, "Erreur interne du worker d'analyse.");
      pendingAnalysisRequestBySource[target] = null;
    }
    pendingAnalysisRequests.clear();
  }
};

function setLoading(loading: boolean): void {
  outputPanel.classList.toggle("loading", loading);
  statsBar.classList.toggle("loading", loading);
}

function scheduleOptimization(delay = 120): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    dispatchOptimization();
  }, delay);
}

function dispatchOptimization(): void {
  if (!originalSvg) return;
  const requestId = ++nextWorkerRequestId;
  pendingOptimizeRequestId = requestId;
  setLoading(true);
  worker.postMessage({
    kind: "optimize",
    id: requestId,
    svgString: originalSvg,
    pluginStates,
    globalOptions,
  });
}

function requestSvgAnalysis(source: AnalysisSource): void {
  const svgString = getSvgForAnalysis(source);
  if (!svgString) {
    setAnalysisPlaceholder(source, getAnalysisUnavailableMessage(source));
    return;
  }

  const cache = analysisCache[source];
  if (cache.result !== null && cache.svg === svgString) {
    renderAnalysis(cache.result, source);
    return;
  }

  const existingRequestId = pendingAnalysisRequestBySource[source];
  if (existingRequestId !== null) {
    const existingRequest = pendingAnalysisRequests.get(existingRequestId);
    if (existingRequest?.svg === svgString) return;
  }

  const requestId = ++nextWorkerRequestId;
  pendingAnalysisRequestBySource[source] = requestId;
  pendingAnalysisRequests.set(requestId, { target: source, svg: svgString });
  setAnalysisPlaceholder(source, getAnalysisLoadingMessage(source));
  worker.postMessage({
    kind: "analyze",
    id: requestId,
    svgString,
  });
}

function handleAnalysisResponse(response: AnalyzeWorkerResponse): void {
  const pending = pendingAnalysisRequests.get(response.id);
  if (!pending) return;
  pendingAnalysisRequests.delete(response.id);

  const { target, svg: analyzedSvg } = pending;
  if (pendingAnalysisRequestBySource[target] !== response.id) return;
  pendingAnalysisRequestBySource[target] = null;

  if (!response.success) {
    analysisCache[target] = { svg: null, result: null };
    setAnalysisPlaceholder(target, "Impossible d'analyser ce SVG.");
    return;
  }

  analysisCache[target] = {
    svg: analyzedSvg,
    result: response.result,
  };

  if (getSvgForAnalysis(target) === analyzedSvg) {
    renderAnalysis(response.result, target);
  }
}

// ─── State ─────────────────────────────────────────────────────────────────
let pluginStates: PluginState = loadPluginStates();
let globalOptions: GlobalOptions = loadGlobalOptions();
let presets: Preset[] = loadPresets();
let originalSvg: string | null = null;
let optimizedSvg: string | null = null;
let optimizedSvgStale = false;
let originalFileName = "optimized.svg";
const analysisCache: Record<AnalysisSource, AnalysisCacheEntry> = {
  original: { svg: null, result: null },
  optimized: { svg: null, result: null },
};

// ─── Batch state ────────────────────────────────────────────────────────────
type BatchFileStatus = "pending" | "processing" | "done" | "error";

interface BatchFile {
  name: string;
  originalContent: string;
  originalSize: number;
  optimizedContent: string | null;
  optimizedSize: number | null;
  savings: number | null;
  status: BatchFileStatus;
}

let batchFiles: BatchFile[] = [];
let batchQueue: number[] = [];
const batchRequestMap = new Map<number, number>(); // requestId → batchIdx
let isBatchMode = false;
let batchSettingsStale = false;

// ─── Element refs ──────────────────────────────────────────────────────────
const dropzone = document.getElementById("dropzone")!;
const workspace = document.getElementById("workspace")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const batchView = document.getElementById("batch-view")!;
const batchList = document.getElementById("batch-list")!;
const batchCountEl = document.getElementById("batch-count")!;
const batchSavingsSummaryEl = document.getElementById("batch-savings-summary")!;
const btnDownloadZip = document.getElementById("btn-download-zip") as HTMLButtonElement;
const btnBatchClear = document.getElementById("btn-batch-clear") as HTMLButtonElement;
const btnBackToBatch = document.getElementById("btn-back-to-batch") as HTMLButtonElement;
const batchStaleBanner = document.getElementById("batch-stale-banner")!;
const btnReoptimizeAll = document.getElementById("btn-reoptimize-all") as HTMLButtonElement;
const pluginsList = document.getElementById("plugins-list")!;

const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;
const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
const btnNew = document.getElementById("btn-new") as HTMLButtonElement;
const btnEnableAll = document.getElementById("btn-enable-all") as HTMLButtonElement;
const btnDisableAll = document.getElementById("btn-disable-all") as HTMLButtonElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;
const btnPasteOpen = document.getElementById("btn-paste-open") as HTMLButtonElement;

const btnPresetsOpen = document.getElementById("btn-presets") as HTMLButtonElement;
const modalPresets = document.getElementById("modal-presets")!;
const presetsClose = document.getElementById("presets-close") as HTMLButtonElement;
const presetNameInput = document.getElementById("preset-name-input") as HTMLInputElement;
const btnPresetSave = document.getElementById("btn-preset-save") as HTMLButtonElement;
const presetsList = document.getElementById("presets-list")!;
const presetsEmpty = document.getElementById("presets-empty")!;
const btnPresetsExport = document.getElementById("btn-presets-export") as HTMLButtonElement;
const btnPresetsImport = document.getElementById("btn-presets-import") as HTMLButtonElement;
const presetsFileInput = document.getElementById("presets-file-input") as HTMLInputElement;

const statSavings = document.getElementById("stat-savings")!.parentElement!;
const statsBar = document.getElementById("stats-bar")!;
const outputPanel = document.getElementById("output-panel")!;

const svgDisplayOriginal = document.getElementById("svg-display-original")!;
const svgDisplayOptimized = document.getElementById("svg-display-optimized")!;
const codeOriginal = document.getElementById("code-original")!;
const codeOptimized = document.getElementById("code-optimized")!;
const analysisPanels: Record<AnalysisSource, HTMLElement> = {
  original: document.getElementById("analysis-panel-original")!,
  optimized: document.getElementById("analysis-panel-optimized")!,
};
const analysisPlaceholders: Record<AnalysisSource, HTMLElement> = {
  original: document.getElementById("analysis-placeholder-original")!,
  optimized: document.getElementById("analysis-placeholder-optimized")!,
};

const modalPaste = document.getElementById("modal-paste")!;
const pasteTextarea = document.getElementById("paste-textarea") as HTMLTextAreaElement;
const btnPasteConfirm = document.getElementById("btn-paste-confirm") as HTMLButtonElement;
const btnPasteCancel = document.getElementById("btn-paste-cancel") as HTMLButtonElement;
const modalClose = document.getElementById("modal-close") as HTMLButtonElement;

// ─── Build sidebar ──────────────────────────────────────────────────────────
function buildSidebar(): void {
  pluginsList.innerHTML = "";

  // ── Global options section ──
  appendGroupLabel("Options générales", true);

  pluginsList.appendChild(
    makeToggleItem(
      "multipass",
      "Passes multiples",
      "Lance SVGO plusieurs fois jusqu'à ce que la taille ne diminue plus. Meilleure compression, légèrement plus lent.",
      globalOptions.multipass,
      (enabled) => {
        globalOptions.multipass = enabled;
        saveGlobalOptions(globalOptions);
        onSettingsChange();
      }
    )
  );

  pluginsList.appendChild(
    makeToggleItem(
      "pretty",
      "Prettify markup",
      "Formate le SVG avec indentation et retours à la ligne. Augmente la taille mais améliore la lisibilité.",
      globalOptions.pretty,
      (enabled) => {
        globalOptions.pretty = enabled;
        saveGlobalOptions(globalOptions);
        indentRow.classList.toggle("hidden", !enabled);
        onSettingsChange();
      }
    )
  );

  // Indent — shown only when pretty=true
  const indentRow = makeNumberInputRow(
    "Indentation",
    globalOptions.indent,
    1, 8, 1,
    (v) => {
      globalOptions.indent = v;
      saveGlobalOptions(globalOptions);
      onSettingsChange();
    }
  );
  if (!globalOptions.pretty) indentRow.classList.add("hidden");
  pluginsList.appendChild(indentRow);

  pluginsList.appendChild(
    makeSliderItem(
      "Précision des nombres",
      "Nombre de décimales pour les valeurs numériques (coordonnées, dimensions). Moins = fichier plus petit mais moins précis.",
      globalOptions.floatPrecision,
      0, 8, 1,
      (v) => {
        globalOptions.floatPrecision = v;
        saveGlobalOptions(globalOptions);
        onSettingsChange();
      }
    )
  );

  pluginsList.appendChild(
    makeSliderItem(
      "Précision des transformations",
      "Nombre de décimales pour les matrices de transformation (translate, rotate, scale). Moins = fichier plus petit mais transformations moins précises.",
      globalOptions.transformPrecision,
      1, 8, 1,
      (v) => {
        globalOptions.transformPrecision = v;
        saveGlobalOptions(globalOptions);
        onSettingsChange();
      }
    )
  );

  // ── Plugin sections grouped ──
  const groups = [...new Set(PLUGIN_DEFS.map((d) => d.group))];

  for (const group of groups) {
    appendGroupLabel(group);

    for (const def of PLUGIN_DEFS.filter((d) => d.group === group)) {
      const enabled = pluginStates[def.name] ?? def.defaultEnabled;
      pluginsList.appendChild(
        makeToggleItem(
          def.name,
          def.label,
          def.description,
          enabled,
          (value) => onPluginToggle(def.name, value),
          def.breaksSvgStandalone ? "Casse les SVG ouverts en standalone" : undefined
        )
      );
    }
  }
}

function appendGroupLabel(text: string, first = false): void {
  const el = document.createElement("div");
  el.className = "plugin-group-label";
  if (first) {
    el.style.borderTop = "none";
    el.style.marginTop = "0";
  }
  el.textContent = text;
  pluginsList.appendChild(el);
}

function makeSliderItem(
  label: string,
  description: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void
): HTMLElement {
  const item = document.createElement("div");
  item.className = "option-item";

  const header = document.createElement("div");
  header.className = "option-header";

  const labelEl = document.createElement("span");
  labelEl.className = "option-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "option-value";
  valueEl.textContent = String(value);

  header.appendChild(labelEl);
  header.appendChild(valueEl);

  const descEl = document.createElement("div");
  descEl.className = "option-desc";
  descEl.textContent = description;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "slider";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    valueEl.textContent = String(v);
    onChange(v);
  });

  item.appendChild(header);
  item.appendChild(descEl);
  item.appendChild(slider);
  return item;
}

function makeNumberInputRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "number-input-row";

  const labelEl = document.createElement("span");
  labelEl.className = "number-input-label";
  labelEl.textContent = label;

  const input = document.createElement("input");
  input.type = "number";
  input.className = "number-input";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  input.addEventListener("change", () => {
    const v = Math.min(max, Math.max(min, Number(input.value)));
    input.value = String(v);
    onChange(v);
  });

  row.appendChild(labelEl);
  row.appendChild(input);
  return row;
}

function makeToggleItem(
  name: string,
  label: string,
  description: string,
  enabled: boolean,
  onChange: (v: boolean) => void,
  warning?: string
): HTMLElement {
  const item = document.createElement("div");
  item.className = "plugin-item";

  const toggleEl = document.createElement("label");
  toggleEl.className = "toggle";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = enabled;
  checkbox.dataset.plugin = name;

  const track = document.createElement("span");
  track.className = "toggle-track";

  toggleEl.appendChild(checkbox);
  toggleEl.appendChild(track);

  const info = document.createElement("div");
  info.className = "plugin-info";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name";
  nameEl.textContent = label;

  const descEl = document.createElement("div");
  descEl.className = "plugin-desc";
  descEl.textContent = description;

  info.appendChild(nameEl);
  info.appendChild(descEl);

  if (warning) {
    const badge = document.createElement("div");
    badge.className = "plugin-warning";
    badge.textContent = `⚠ ${warning}`;
    info.appendChild(badge);
  }

  item.appendChild(toggleEl);
  item.appendChild(info);

  item.addEventListener("click", (e) => {
    if (e.target === checkbox || e.target === toggleEl || e.target === track) return;
    checkbox.checked = !checkbox.checked;
    onChange(checkbox.checked);
  });

  checkbox.addEventListener("change", () => {
    onChange(checkbox.checked);
  });

  return item;
}

function onPluginToggle(name: string, enabled: boolean): void {
  pluginStates[name] = enabled;
  savePluginStates(pluginStates);
  onSettingsChange();
}

// ─── Load SVG ──────────────────────────────────────────────────────────────
function loadSvg(content: string, filename = "optimized.svg"): void {
  originalSvg = content;
  optimizedSvg = null;
  optimizedSvgStale = false;
  originalFileName = filename.replace(/\.svg$/i, "") + "-optimized.svg";
  dropzone.hidden = true;
  workspace.hidden = false;
  svgDisplayOriginal.innerHTML = content;
  svgDisplayOptimized.innerHTML = '<div class="loading-spinner"><div class="spinner-ring"></div></div>';
  codeOriginal.textContent = content;
  codeOptimized.textContent = "";
  btnCopy.disabled = true;
  btnDownload.disabled = true;
  resetAnalysisState();
  refreshAllAnalysisViews();
  scheduleOptimization(0); // immediate on first load
}

// ─── File input ────────────────────────────────────────────────────────────
fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files ?? []);
  fileInput.value = "";
  if (files.length === 0) return;
  if (isBatchMode) {
    addFilesToBatch(files);
  } else if (files.length === 1) {
    const reader = new FileReader();
    reader.onload = (e) => loadSvg(e.target?.result as string, files[0].name);
    reader.readAsText(files[0]);
  } else {
    initBatchMode(files);
  }
});

// ─── Drag & drop ──────────────────────────────────────────────────────────
function isSvgFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(".svg") || f.type === "image/svg+xml";
}

async function collectSvgFilesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res));
      if (isSvgFile(file)) files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const subEntries = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res));
      files.push(...await collectSvgFilesFromEntries(subEntries));
    }
  }
  return files;
}

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});

document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropzone.classList.remove("drag-over");
});

document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");

  const items = Array.from(e.dataTransfer?.items ?? []);
  const entries = items.map((i) => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[];
  const files = await collectSvgFilesFromEntries(entries);

  if (files.length === 0) {
    showToast("Aucun fichier SVG trouvé.");
    return;
  }
  if (isBatchMode) {
    addFilesToBatch(files);
  } else if (files.length === 1) {
    const reader = new FileReader();
    reader.onload = (ev) => loadSvg(ev.target?.result as string, files[0].name);
    reader.readAsText(files[0]);
  } else {
    initBatchMode(files);
  }
});

// ─── Paste modal ───────────────────────────────────────────────────────────
function openPasteModal(): void {
  pasteTextarea.value = "";
  modalPaste.classList.remove("hidden");
  pasteTextarea.focus();
}

function closePasteModal(): void {
  modalPaste.classList.add("hidden");
}

btnPasteOpen.addEventListener("click", openPasteModal);
modalClose.addEventListener("click", closePasteModal);
btnPasteCancel.addEventListener("click", closePasteModal);
modalPaste.addEventListener("click", (e) => {
  if (e.target === modalPaste) closePasteModal();
});

btnPasteConfirm.addEventListener("click", () => {
  const text = pasteTextarea.value.trim();
  if (!text) return;
  if (!text.includes("<svg")) {
    showToast("Le texte ne semble pas être un SVG valide.");
    return;
  }
  closePasteModal();
  loadSvg(text, "pasted.svg");
});

document.addEventListener("paste", (e) => {
  if (!dropzone.hidden) return;
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (text.includes("<svg")) loadSvg(text, "pasted.svg");
});

// ─── Sidebar bulk actions ──────────────────────────────────────────────────
btnEnableAll.addEventListener("click", () => {
  for (const def of PLUGIN_DEFS) {
    // Never auto-enable plugins that break standalone SVG files
    if (!def.breaksSvgStandalone) pluginStates[def.name] = true;
  }
  globalOptions.multipass = true;
  savePluginStates(pluginStates);
  saveGlobalOptions(globalOptions);
  buildSidebar();
  onSettingsChange();
});

btnDisableAll.addEventListener("click", () => {
  for (const def of PLUGIN_DEFS) pluginStates[def.name] = false;
  globalOptions.multipass = false;
  savePluginStates(pluginStates);
  saveGlobalOptions(globalOptions);
  buildSidebar();
  onSettingsChange();
});

btnReset.addEventListener("click", () => {
  pluginStates = getDefaultStates();
  globalOptions = { ...DEFAULT_GLOBAL_OPTIONS };
  savePluginStates(pluginStates);
  saveGlobalOptions(globalOptions);
  buildSidebar();
  onSettingsChange();
});

// ─── New file ──────────────────────────────────────────────────────────────
btnNew.addEventListener("click", () => {
  originalSvg = null;
  optimizedSvg = null;
  optimizedSvgStale = false;
  resetAnalysisState();
  workspace.hidden = true;
  dropzone.hidden = false;
  btnCopy.disabled = true;
  btnDownload.disabled = true;
  svgDisplayOriginal.innerHTML = "";
  svgDisplayOptimized.innerHTML = "";
  codeOriginal.textContent = "";
  codeOptimized.textContent = "";
  refreshAllAnalysisViews();
});

// ─── Copy to clipboard ─────────────────────────────────────────────────────
btnCopy.addEventListener("click", async () => {
  if (!optimizedSvg) return;
  try {
    await navigator.clipboard.writeText(optimizedSvg);
    showToast("SVG copié dans le presse-papier !");
  } catch {
    showToast("Échec de la copie. Vérifiez les permissions.");
  }
});

// ─── Download ──────────────────────────────────────────────────────────────
btnDownload.addEventListener("click", () => {
  if (!optimizedSvg) return;

  if (pluginStates["removeXMLNS"] === true) {
    showToast("⚠ xmlns supprimé — le fichier peut ne pas s'ouvrir correctement en standalone.");
  }

  const blob = new Blob([optimizedSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = originalFileName;
  a.click();
  // Delay revocation to ensure browser has initiated the download
  setTimeout(() => URL.revokeObjectURL(url), 100);
});

// ─── Tabs ──────────────────────────────────────────────────────────────────
const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
const tabPanels: Record<string, HTMLElement> = {
  preview: document.getElementById("tab-preview")!,
  code: document.getElementById("tab-code")!,
  analysis: document.getElementById("tab-analysis")!,
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab!;
    for (const [key, panel] of Object.entries(tabPanels)) {
      panel.classList.toggle("hidden", key !== target);
    }
  });
});

interface PotentialGain {
  level: "opportunity" | "warning" | "info";
  title: string;
  description: string;
  impactBytes: number;
}

function getSvgForAnalysis(source: AnalysisSource): string | null {
  if (source === "original") return originalSvg;
  if (optimizedSvgStale) return null;
  return optimizedSvg;
}

function getAnalysisSourceLabel(source: AnalysisSource): string {
  return source === "original" ? "originale" : "optimisée";
}

function getAnalysisLoadingMessage(source: AnalysisSource): string {
  return `Analyse de la version ${getAnalysisSourceLabel(source)} en cours…`;
}

function getAnalysisUnavailableMessage(source: AnalysisSource): string {
  if (!originalSvg) return "Chargez un SVG pour lancer l'analyse.";
  if (source === "optimized") return "Analyse de la version optimisée en attente de l'optimisation…";
  return "Analyse de la version originale indisponible.";
}

function invalidateAnalysisCache(source: AnalysisSource): void {
  analysisCache[source] = { svg: null, result: null };
}

function resetAnalysisState(): void {
  invalidateAnalysisCache("original");
  invalidateAnalysisCache("optimized");
  for (const source of ["original", "optimized"] as const) {
    pendingAnalysisRequestBySource[source] = null;
  }
  pendingAnalysisRequests.clear();
}

function refreshAllAnalysisViews(): void {
  for (const source of ["original", "optimized"] as const) {
    const svgString = getSvgForAnalysis(source);
    if (!svgString) {
      setAnalysisPlaceholder(source, getAnalysisUnavailableMessage(source));
      continue;
    }
    requestSvgAnalysis(source);
  }
}

function setAnalysisPlaceholder(source: AnalysisSource, message: string): void {
  const placeholder = analysisPlaceholders[source];
  placeholder.textContent = message;
  analysisPanels[source].replaceChildren(placeholder);
}

function renderAnalysis(analysis: SvgAnalysis, source: AnalysisSource): void {
  const stack = document.createElement("div");
  stack.className = "analysis-stack";

  const note = document.createElement("div");
  note.className = "analysis-note";
  note.textContent = `Version analysée : ${getAnalysisSourceLabel(source)}. Répartition estimée sur une version normalisée du SVG pour attribuer les octets par tag et attribut.`;
  stack.appendChild(note);

  stack.appendChild(buildAnalysisSummary(analysis));

  const gains = derivePotentialGains(analysis);
  stack.appendChild(
    createSection(
      "Gains Potentiels",
      gains.length > 0 ? `${gains.length} piste${gains.length > 1 ? "s" : ""} détectée${gains.length > 1 ? "s" : ""}` : "Aucun signal évident",
      gains.length > 0 ? buildGainList(gains) : makeEmptyState("Rien de particulièrement coûteux ne ressort au-delà des optimisations SVGO déjà en place.")
    )
  );

  const tableGrid = document.createElement("div");
  tableGrid.className = "analysis-table-grid";
  tableGrid.appendChild(
    createSection(
      "Poids Direct Par Tag",
      "Ouverture/fermeture des balises + attributs",
      buildBreakdownTable(
        analysis.tagBreakdown.slice(0, 10).map((bucket) => ({
          name: bucket.name,
          count: bucket.count,
          bytes: bucket.directBytes,
          share: formatShare(bucket.directBytes, analysis.normalizedSize),
        })),
        "Tag"
      )
    )
  );
  tableGrid.appendChild(
    createSection(
      "Attributs Dominants",
      "Contribution cumulée de chaque attribut",
      buildBreakdownTable(
        analysis.attributeBreakdown.slice(0, 10).map((bucket) => ({
          name: bucket.name,
          count: bucket.count,
          bytes: bucket.bytes,
          share: formatShare(bucket.bytes, analysis.normalizedSize),
        })),
        "Attribut"
      )
    )
  );
  stack.appendChild(tableGrid);

  stack.appendChild(
    createSection(
      "Sous-arbres Les Plus Lourds",
      "Poids du nœud complet avec ses descendants",
      buildHeavyNodeList(analysis)
    )
  );
  stack.appendChild(
    createSection(
      "Rasters Embarqués",
      analysis.embeddedRasters.length > 0 ? "Images data URI non traitées par SVGO" : "Aucun raster embarqué détecté",
      buildRasterList(analysis)
    )
  );

  analysisPanels[source].replaceChildren(stack);
}

function buildAnalysisSummary(analysis: SvgAnalysis): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "analysis-summary-grid";

  const topTag = analysis.tagBreakdown[0];
  const rasterBytes = analysis.embeddedRasters.reduce((sum, raster) => sum + raster.sourceBytes, 0);
  const topHeavyNode = analysis.heavyNodes[0];

  grid.appendChild(
    createSummaryCard("Taille analysée", formatBytes(analysis.normalizedSize), `${analysis.tagBreakdown.length} postes suivis`)
  );
  grid.appendChild(
    createSummaryCard("Éléments", String(analysis.elementCount), `${analysis.attributeBreakdown.length} attributs distincts`)
  );
  grid.appendChild(
    createSummaryCard(
      "Rasters",
      analysis.embeddedRasters.length > 0 ? String(analysis.embeddedRasters.length) : "Aucun",
      analysis.embeddedRasters.length > 0 ? formatBytes(rasterBytes) : "SVG 100% vectoriel"
    )
  );
  grid.appendChild(
    createSummaryCard(
      "Point chaud",
      topTag ? topTag.name : "—",
      topHeavyNode ? `${formatBytes(topHeavyNode.bytes)} max` : "Aucun sous-arbre notable"
    )
  );

  return grid;
}

function createSummaryCard(label: string, value: string, subvalue: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "analysis-card";

  const labelEl = document.createElement("span");
  labelEl.className = "analysis-card-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "analysis-card-value";
  valueEl.textContent = value;

  const subvalueEl = document.createElement("span");
  subvalueEl.className = "analysis-card-subvalue";
  subvalueEl.textContent = subvalue;

  card.appendChild(labelEl);
  card.appendChild(valueEl);
  card.appendChild(subvalueEl);
  return card;
}

function createSection(title: string, subtitle: string, body: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.className = "analysis-section";

  const header = document.createElement("div");
  header.className = "analysis-section-header";

  const titleEl = document.createElement("div");
  titleEl.className = "analysis-section-title";
  titleEl.textContent = title;

  const subtitleEl = document.createElement("div");
  subtitleEl.className = "analysis-section-subtitle";
  subtitleEl.textContent = subtitle;

  header.appendChild(titleEl);
  header.appendChild(subtitleEl);

  const sectionBody = document.createElement("div");
  sectionBody.className = "analysis-section-body";
  sectionBody.appendChild(body);

  section.appendChild(header);
  section.appendChild(sectionBody);
  return section;
}

function buildGainList(gains: PotentialGain[]): HTMLElement {
  const container = document.createElement("div");
  container.className = "analysis-gains";

  for (const gain of gains) {
    const item = document.createElement("div");
    item.className = `analysis-gain analysis-gain--${gain.level}`;

    const title = document.createElement("div");
    title.className = "analysis-gain-title";
    title.textContent = gain.title;

    const body = document.createElement("div");
    body.className = "analysis-gain-body";
    body.textContent = gain.description;

    item.appendChild(title);
    item.appendChild(body);
    container.appendChild(item);
  }

  return container;
}

function buildBreakdownTable(
  rows: Array<{ name: string; count: number; bytes: number; share: string }>,
  firstColumnLabel: string
): HTMLElement {
  if (rows.length === 0) {
    return makeEmptyState("Aucune donnée disponible.");
  }

  const table = document.createElement("table");
  table.className = "analysis-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of [firstColumnLabel, "Occ.", "Poids", "Part"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(makeCell(row.name));
    tr.appendChild(makeCell(String(row.count), "analysis-muted"));
    tr.appendChild(makeCell(formatBytes(row.bytes)));
    tr.appendChild(makeCell(row.share));
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function buildHeavyNodeList(analysis: SvgAnalysis): HTMLElement {
  if (analysis.heavyNodes.length === 0) {
    return makeEmptyState("Aucun sous-arbre significatif trouvé.");
  }

  const list = document.createElement("div");
  list.className = "analysis-heavy-list";

  for (const node of analysis.heavyNodes.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "analysis-heavy-item";

    const topLine = document.createElement("div");
    topLine.className = "analysis-heavy-topline";

    const label = document.createElement("div");
    label.className = "analysis-heavy-label";
    label.textContent = node.label;

    const bytes = document.createElement("div");
    bytes.className = "analysis-heavy-bytes";
    bytes.textContent = formatBytes(node.bytes);

    topLine.appendChild(label);
    topLine.appendChild(bytes);

    const path = document.createElement("div");
    path.className = "analysis-heavy-path";
    path.textContent = node.note ? `${node.selector} · ${node.note}` : node.selector;

    item.appendChild(topLine);
    item.appendChild(path);
    list.appendChild(item);
  }

  return list;
}

function buildRasterList(analysis: SvgAnalysis): HTMLElement {
  if (analysis.embeddedRasters.length === 0) {
    return makeEmptyState("Aucune balise pointant vers un raster en data URI n'a été trouvée.");
  }

  const list = document.createElement("div");
  list.className = "analysis-raster-list";

  for (const raster of analysis.embeddedRasters.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "analysis-raster-item";

    const topLine = document.createElement("div");
    topLine.className = "analysis-raster-topline";

    const label = document.createElement("div");
    label.className = "analysis-raster-label";
    label.textContent = `<${raster.tagName}> · ${raster.mimeType}`;

    const bytes = document.createElement("div");
    bytes.className = "analysis-raster-bytes";
    bytes.textContent = formatBytes(raster.sourceBytes);

    topLine.appendChild(label);
    topLine.appendChild(bytes);

    const meta = document.createElement("div");
    meta.className = "analysis-raster-meta";
    meta.textContent = raster.selector;

    const badges = document.createElement("div");
    badges.className = "analysis-badge-row";
    badges.appendChild(makeBadge(raster.encoding));
    if (raster.width !== null && raster.height !== null) {
      badges.appendChild(makeBadge(`${trimNumber(raster.width)} × ${trimNumber(raster.height)}`));
    }
    if (raster.decodedBytes !== null) {
      badges.appendChild(makeBadge(`payload ${formatBytes(raster.decodedBytes)}`));
      const overhead = raster.sourceBytes - raster.decodedBytes;
      if (overhead > 0) badges.appendChild(makeBadge(`surcoût ${formatBytes(overhead)}`));
    }

    item.appendChild(topLine);
    item.appendChild(meta);
    item.appendChild(badges);
    list.appendChild(item);
  }

  return list;
}

function derivePotentialGains(analysis: SvgAnalysis): PotentialGain[] {
  const gains: PotentialGain[] = [];

  const rasterBytes = analysis.embeddedRasters.reduce((sum, raster) => sum + raster.sourceBytes, 0);
  if (rasterBytes > 0) {
    gains.push({
      level: rasterBytes >= analysis.normalizedSize * 0.25 ? "opportunity" : "info",
      title: "Les rasters embarqués restent hors du champ de SVGO",
      description: `${analysis.embeddedRasters.length} image(s) raster représentent ${formatBytes(rasterBytes)} dans les data URI. C'est le meilleur candidat pour une future étape de resize/recompression.`,
      impactBytes: rasterBytes,
    });
  }

  const pathDataBytes = getAttributeBytes(analysis, "d");
  if (pathDataBytes > analysis.normalizedSize * 0.22) {
    gains.push({
      level: "warning",
      title: "Les tracés dominent encore le poids du fichier",
      description: `L'attribut d cumule ${formatBytes(pathDataBytes)}. Si le rendu le permet, une simplification amont ou une précision numérique plus basse peut encore aider.`,
      impactBytes: pathDataBytes,
    });
  }

  const extraDigits = estimateExtraDigits(analysis.numericLiteralHistogram, globalOptions.floatPrecision);
  if (extraDigits > 40) {
    gains.push({
      level: "info",
      title: "Beaucoup de décimales dépassent la précision courante",
      description: `Environ ${extraDigits} caractères numériques dépassent ${globalOptions.floatPrecision} décimales dans les attributs. Tester une précision plus basse vaut probablement le coup sur certains assets.`,
      impactBytes: extraDigits,
    });
  }

  const styleWeight = getAttributeBytes(analysis, "style") + getTagSubtreeBytes(analysis, "style");
  if (styleWeight > Math.max(200, analysis.normalizedSize * 0.08)) {
    gains.push({
      level: "info",
      title: "Les styles occupent une part visible du SVG",
      description: `Styles inline et blocs <style> pèsent ensemble ${formatBytes(styleWeight)}. Il peut rester du gain en fusionnant, minifiant ou convertissant certains styles.`,
      impactBytes: styleWeight,
    });
  }

  const removableDocumentWeight =
    getTagDirectBytes(analysis, "#comment") +
    getTagSubtreeBytes(analysis, "metadata") +
    getTagSubtreeBytes(analysis, "script") +
    getTagSubtreeBytes(analysis, "title") +
    getTagSubtreeBytes(analysis, "desc");

  if (removableDocumentWeight > 0) {
    const disabledCleanupPlugins = [
      pluginStates.removeComments ? null : "removeComments",
      pluginStates.removeMetadata ? null : "removeMetadata",
      pluginStates.removeTitle ? null : "removeTitle",
      pluginStates.removeDesc ? null : "removeDesc",
      pluginStates.removeScriptElement ? null : "removeScriptElement",
    ].filter(Boolean);

    gains.push({
      level: disabledCleanupPlugins.length > 0 ? "opportunity" : "info",
      title: "Des métadonnées et contenus annexes restent présents",
      description:
        disabledCleanupPlugins.length > 0
          ? `${formatBytes(removableDocumentWeight)} restent dans commentaires, metadata, title, desc ou script. Les plugins désactivés ${disabledCleanupPlugins.join(", ")} sont les premiers leviers à tester.`
          : `${formatBytes(removableDocumentWeight)} résident dans commentaires, metadata, title, desc ou script. Certains sont sans doute volontaires, mais ce poste mérite d'être vérifié.`,
      impactBytes: removableDocumentWeight,
    });
  }

  return gains.sort((a, b) => b.impactBytes - a.impactBytes).slice(0, 4);
}

function getAttributeBytes(analysis: SvgAnalysis, name: string): number {
  return analysis.attributeBreakdown.find((bucket) => bucket.name === name)?.bytes ?? 0;
}

function getTagDirectBytes(analysis: SvgAnalysis, name: string): number {
  return analysis.tagBreakdown.find((bucket) => bucket.name === name)?.directBytes ?? 0;
}

function getTagSubtreeBytes(analysis: SvgAnalysis, name: string): number {
  return analysis.tagBreakdown.find((bucket) => bucket.name === name)?.subtreeBytes ?? 0;
}

function estimateExtraDigits(histogram: number[], precision: number): number {
  let extraDigits = 0;
  for (let decimals = precision + 1; decimals < histogram.length; decimals++) {
    extraDigits += (histogram[decimals] ?? 0) * (decimals - precision);
  }
  return extraDigits;
}

function makeBadge(text: string): HTMLElement {
  const badge = document.createElement("div");
  badge.className = "analysis-badge";
  badge.textContent = text;
  return badge;
}

function makeEmptyState(text: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "analysis-empty-state";
  empty.textContent = text;
  return empty;
}

function makeCell(text: string, className?: string): HTMLElement {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function formatShare(bytes: number, total: number): string {
  if (total <= 0) return "0%";
  const share = (bytes / total) * 100;
  return `${share.toFixed(share >= 10 ? 0 : 1)}%`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ─── Toast ─────────────────────────────────────────────────────────────────
function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 2500);
}

// ─── Presets ───────────────────────────────────────────────────────────────
function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts));
}

function renderPresetsList(): void {
  // Remove existing rows (keep the empty placeholder)
  Array.from(presetsList.querySelectorAll(".preset-row")).forEach((el) => el.remove());

  presetsEmpty.hidden = presets.length > 0;

  for (const preset of [...presets].reverse()) {
    const row = document.createElement("div");
    row.className = "preset-row";

    const info = document.createElement("div");
    info.className = "preset-info";

    const name = document.createElement("div");
    name.className = "preset-row-name";
    name.textContent = preset.name;

    const date = document.createElement("div");
    date.className = "preset-row-date";
    date.textContent = formatDate(preset.createdAt);

    info.appendChild(name);
    info.appendChild(date);

    const actions = document.createElement("div");
    actions.className = "preset-row-actions";

    const btnApply = document.createElement("button");
    btnApply.className = "btn btn-sm btn-secondary";
    btnApply.textContent = "Appliquer";
    btnApply.addEventListener("click", () => applyPreset(preset));

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn btn-sm btn-ghost";
    btnDelete.textContent = "Supprimer";
    btnDelete.style.color = "var(--danger)";
    btnDelete.addEventListener("click", () => deletePreset(preset.id));

    actions.appendChild(btnApply);
    actions.appendChild(btnDelete);
    row.appendChild(info);
    row.appendChild(actions);
    presetsList.appendChild(row);
  }
}

function applyPreset(preset: Preset): void {
  pluginStates = { ...preset.pluginStates };
  globalOptions = { ...preset.globalOptions };
  savePluginStates(pluginStates);
  saveGlobalOptions(globalOptions);
  buildSidebar();
  onSettingsChange(true);
  closePresetsModal();
  showToast(`Préréglage "${preset.name}" appliqué.`);
}

function deletePreset(id: string): void {
  presets = presets.filter((p) => p.id !== id);
  savePresets(presets);
  renderPresetsList();
}

function openPresetsModal(): void {
  presetNameInput.value = "";
  renderPresetsList();
  modalPresets.classList.remove("hidden");
  presetNameInput.focus();
}

function closePresetsModal(): void {
  modalPresets.classList.add("hidden");
}

btnPresetsOpen.addEventListener("click", openPresetsModal);
presetsClose.addEventListener("click", closePresetsModal);
modalPresets.addEventListener("click", (e) => {
  if (e.target === modalPresets) closePresetsModal();
});

btnPresetSave.addEventListener("click", () => {
  const name = presetNameInput.value.trim();
  if (!name) {
    presetNameInput.focus();
    return;
  }
  const preset = createPreset(name, pluginStates, globalOptions);
  presets = [...presets, preset];
  savePresets(presets);
  presetNameInput.value = "";
  renderPresetsList();
  showToast(`Préréglage "${name}" sauvegardé.`);
});

presetNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnPresetSave.click();
});

// Export
btnPresetsExport.addEventListener("click", () => {
  if (presets.length === 0) {
    showToast("Aucun préréglage à exporter.");
    return;
  }
  const json = exportPresetsToJson(presets);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "svg-optimizer-presets.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
});

// Import
btnPresetsImport.addEventListener("click", () => presetsFileInput.click());

presetsFileInput.addEventListener("change", () => {
  const file = presetsFileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const { presets: merged, added, skipped } = importPresetsFromJson(
        e.target?.result as string,
        presets
      );
      presets = merged;
      savePresets(presets);
      renderPresetsList();
      showToast(
        `Import terminé : ${added} ajouté${added > 1 ? "s" : ""}${skipped ? `, ${skipped} ignoré${skipped > 1 ? "s" : ""}` : ""}.`
      );
    } catch {
      showToast("Fichier JSON invalide.");
    }
  };
  reader.readAsText(file);
  presetsFileInput.value = "";
});

// ─── Settings change handler ────────────────────────────────────────────────
function onSettingsChange(immediate = false): void {
  if (isBatchMode) {
    // Always mark batch as stale when settings change, regardless of current view
    batchSettingsStale = true;
    if (!batchView.hidden) {
      // Currently on the batch list — show the banner immediately
      batchStaleBanner.hidden = false;
    }
    // If on a file preview, the banner will appear when returning to the list (goBackToBatch)
  }
  if (originalSvg) {
    optimizedSvgStale = true;
    invalidateAnalysisCache("optimized");
    refreshAllAnalysisViews();
  }
  if (originalSvg) {
    scheduleOptimization(immediate ? 0 : undefined);
  }
}

function reoptimizeBatch(): void {
  batchSettingsStale = false;
  batchStaleBanner.hidden = true;
  batchQueue = [];
  batchRequestMap.clear();
  btnDownloadZip.disabled = true;

  for (let i = 0; i < batchFiles.length; i++) {
    batchFiles[i].status = "pending";
    batchFiles[i].optimizedContent = null;
    batchFiles[i].optimizedSize = null;
    batchFiles[i].savings = null;
    updateBatchRow(i);
    batchQueue.push(i);
  }

  updateBatchSummary();
  processBatchQueue();
}

// ─── Batch processing ──────────────────────────────────────────────────────
function initBatchMode(files: File[]): void {
  isBatchMode = true;
  batchSettingsStale = false;
  batchFiles = [];
  batchQueue = [];
  batchRequestMap.clear();
  originalSvg = null;
  optimizedSvg = null;
  optimizedSvgStale = false;
  resetAnalysisState();

  dropzone.hidden = true;
  workspace.hidden = true;
  batchView.hidden = false;
  btnBackToBatch.hidden = true;

  addFilesToBatch(files);
}

function addFilesToBatch(files: File[]): void {
  const startIdx = batchFiles.length;
  let loaded = 0;

  for (const file of files) {
    const idx = batchFiles.length;
    batchFiles.push({
      name: file.name,
      originalContent: "",
      originalSize: 0,
      optimizedContent: null,
      optimizedSize: null,
      savings: null,
      status: "pending",
    });
    renderBatchRow(idx);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      batchFiles[idx].originalContent = content;
      batchFiles[idx].originalSize = new Blob([content]).size;
      loaded++;

      updateBatchRow(idx);
      updateBatchSummary();

      if (loaded === files.length) {
        for (let i = startIdx; i < batchFiles.length; i++) batchQueue.push(i);
        processBatchQueue();
      }
    };
    reader.readAsText(file);
  }
}

function processBatchQueue(): void {
  if (batchQueue.length === 0) {
    updateBatchSummary();
    return;
  }
  const idx = batchQueue[0];
  batchFiles[idx].status = "processing";
  updateBatchRow(idx);

  const requestId = ++nextWorkerRequestId;
  batchRequestMap.set(requestId, idx);

  worker.postMessage({
    kind: "optimize",
    id: requestId,
    svgString: batchFiles[idx].originalContent,
    pluginStates,
    globalOptions,
  });
}

function handleBatchResponse(batchIdx: number, data: OptimizeWorkerResponse): void {
  batchQueue.shift();

  if (data.success) {
    batchFiles[batchIdx].status = "done";
    batchFiles[batchIdx].optimizedContent = data.result.data;
    batchFiles[batchIdx].optimizedSize = data.result.optimizedSize;
    batchFiles[batchIdx].savings = data.result.savings;
  } else {
    batchFiles[batchIdx].status = "error";
  }

  updateBatchRow(batchIdx);
  updateBatchSummary();

  const allSettled = batchFiles.every((f) => f.status === "done" || f.status === "error");
  if (allSettled && batchQueue.length === 0) {
    btnDownloadZip.disabled = !batchFiles.some((f) => f.status === "done");
    const done = batchFiles.filter((f) => f.status === "done").length;
    showToast(`Optimisation terminée : ${done}/${batchFiles.length} fichier${batchFiles.length > 1 ? "s" : ""}.`);
  }

  processBatchQueue();
}

function renderBatchRow(idx: number): void {
  batchList.appendChild(makeBatchRow(idx));
}

function updateBatchRow(idx: number): void {
  const existing = batchList.querySelector<HTMLElement>(`.batch-row[data-idx="${idx}"]`);
  if (existing) existing.replaceWith(makeBatchRow(idx));
}

function makeBatchRow(idx: number): HTMLElement {
  const f = batchFiles[idx];
  const row = document.createElement("div");
  row.className = "batch-row";
  row.dataset.idx = String(idx);

  const statusDot = document.createElement("div");
  statusDot.className = `batch-status batch-status--${f.status}`;

  const name = document.createElement("div");
  name.className = "batch-name";
  name.textContent = f.name;
  name.title = f.name;

  const sizeOrig = document.createElement("div");
  sizeOrig.className = "batch-cell batch-size";
  sizeOrig.textContent = f.originalSize ? formatBytes(f.originalSize) : "—";

  const arrow = document.createElement("div");
  arrow.className = "batch-arrow";
  arrow.textContent = "→";

  const sizeOpt = document.createElement("div");
  sizeOpt.className = "batch-cell batch-size";
  sizeOpt.textContent = f.optimizedSize !== null ? formatBytes(f.optimizedSize) : "—";

  const savingsCell = document.createElement("div");
  if (f.savings !== null) {
    savingsCell.className = `batch-savings-cell${f.savings < 0 ? " negative" : ""}`;
    savingsCell.textContent = f.savings >= 0 ? `−${f.savings}%` : `+${Math.abs(f.savings)}%`;
  } else {
    savingsCell.className = "batch-savings-cell muted";
    savingsCell.textContent = f.status === "error" ? "Erreur" : "—";
  }

  const actions = document.createElement("div");
  actions.className = "batch-row-actions";

  const btnDl = document.createElement("button");
  btnDl.className = "btn btn-sm btn-ghost";
  btnDl.textContent = "Télécharger";
  btnDl.disabled = f.status !== "done";
  btnDl.addEventListener("click", (e) => { e.stopPropagation(); downloadBatchFile(idx); });

  const btnPreview = document.createElement("button");
  btnPreview.className = "btn btn-sm btn-secondary";
  btnPreview.textContent = "Aperçu";
  btnPreview.addEventListener("click", (e) => { e.stopPropagation(); openBatchFileInWorkspace(idx); });

  actions.appendChild(btnDl);
  actions.appendChild(btnPreview);

  row.appendChild(statusDot);
  row.appendChild(name);
  row.appendChild(sizeOrig);
  row.appendChild(arrow);
  row.appendChild(sizeOpt);
  row.appendChild(savingsCell);
  row.appendChild(actions);

  return row;
}

function updateBatchSummary(): void {
  const total = batchFiles.length;
  const done = batchFiles.filter((f) => f.status === "done").length;
  const pending = batchFiles.filter((f) => f.status === "pending" || f.status === "processing").length;

  batchCountEl.textContent = pending > 0
    ? `${done}/${total} fichier${total > 1 ? "s" : ""} optimisé${done > 1 ? "s" : ""}`
    : `${total} fichier${total > 1 ? "s" : ""}`;

  const doneSavings = batchFiles
    .filter((f) => f.status === "done" && f.savings !== null)
    .map((f) => f.savings!);

  if (doneSavings.length > 0) {
    const totalOriginal = batchFiles
      .filter((f) => f.status === "done")
      .reduce((s, f) => s + f.originalSize, 0);
    const totalOptimized = batchFiles
      .filter((f) => f.status === "done")
      .reduce((s, f) => s + (f.optimizedSize ?? 0), 0);
    const globalSavings = totalOriginal > 0
      ? Math.round((1 - totalOptimized / totalOriginal) * 100)
      : 0;
    batchSavingsSummaryEl.textContent = globalSavings >= 0
      ? `· Économie globale : −${globalSavings}%`
      : `· Taille globale : +${Math.abs(globalSavings)}%`;
  } else {
    batchSavingsSummaryEl.textContent = pending > 0 ? "· Optimisation en cours…" : "";
  }
}

function downloadBatchFile(idx: number): void {
  const f = batchFiles[idx];
  if (!f.optimizedContent) return;
  const blob = new Blob([f.optimizedContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name.replace(/\.svg$/i, "") + "-optimized.svg";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function openBatchFileInWorkspace(idx: number): void {
  const f = batchFiles[idx];
  const hasOptimizedResult = f.status === "done" && f.optimizedContent !== null;
  batchView.hidden = true;
  btnBackToBatch.hidden = false;

  // Populate the original side
  originalSvg = f.originalContent;
  optimizedSvg = f.status === "done" ? f.optimizedContent : null;
  optimizedSvgStale = false;
  originalFileName = f.name.replace(/\.svg$/i, "") + "-optimized.svg";
  dropzone.hidden = true;
  workspace.hidden = false;
  svgDisplayOriginal.innerHTML = f.originalContent;
  svgDisplayOptimized.innerHTML = '<div class="loading-spinner"><div class="spinner-ring"></div></div>';
  codeOriginal.textContent = f.originalContent;
  resetAnalysisState();
  codeOptimized.textContent = optimizedSvg ?? "";
  refreshAllAnalysisViews();

  if (hasOptimizedResult) {
    // Result already computed — display it directly, no worker call
    applyOptimizationResult({
      data: f.optimizedContent!,
      originalSize: f.originalSize,
      optimizedSize: f.optimizedSize!,
      savings: f.savings!,
    });
  } else {
    // Not yet done (pending/processing/error) — run optimization normally
    scheduleOptimization(0);
  }
}

function goBackToBatch(): void {
  workspace.hidden = true;
  btnBackToBatch.hidden = true;
  batchView.hidden = false;
  batchStaleBanner.hidden = !batchSettingsStale;
  originalSvg = null;
  optimizedSvg = null;
  optimizedSvgStale = false;
  resetAnalysisState();
  refreshAllAnalysisViews();
}

async function downloadZip(): Promise<void> {
  const done = batchFiles.filter((f) => f.status === "done" && f.optimizedContent);
  if (done.length === 0) return;

  const zip = new JSZip();
  for (const f of done) {
    zip.file(f.name.replace(/\.svg$/i, "") + "-optimized.svg", f.optimizedContent!);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "svg-optimized.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ─── Batch event handlers ───────────────────────────────────────────────────
const btnBatchAdd = document.getElementById("btn-batch-add") as HTMLButtonElement;
btnBatchAdd.addEventListener("click", () => fileInput.click());

btnDownloadZip.addEventListener("click", () => { downloadZip(); });
btnReoptimizeAll.addEventListener("click", reoptimizeBatch);

btnBatchClear.addEventListener("click", () => {
  isBatchMode = false;
  batchFiles = [];
  batchQueue = [];
  batchRequestMap.clear();
  originalSvg = null;
  optimizedSvg = null;
  optimizedSvgStale = false;
  resetAnalysisState();
  batchList.innerHTML = "";
  batchView.hidden = true;
  btnDownloadZip.disabled = true;
  dropzone.hidden = false;
  workspace.hidden = true;
  btnBackToBatch.hidden = true;
  refreshAllAnalysisViews();
});

btnBackToBatch.addEventListener("click", goBackToBatch);

// ─── Init ──────────────────────────────────────────────────────────────────
buildSidebar();
refreshAllAnalysisViews();
