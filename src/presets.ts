import type { PluginState, GlobalOptions } from "./settings";

export interface Preset {
  id: string;
  name: string;
  createdAt: number;
  pluginStates: PluginState;
  globalOptions: GlobalOptions;
}

const STORAGE_KEY = "svgo-optimizer-presets";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Preset[];
    }
  } catch {
    // ignore
  }
  return [];
}

export function savePresets(presets: Preset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function createPreset(
  name: string,
  pluginStates: PluginState,
  globalOptions: GlobalOptions
): Preset {
  return {
    id: generateId(),
    name: name.trim(),
    createdAt: Date.now(),
    pluginStates: { ...pluginStates },
    globalOptions: { ...globalOptions },
  };
}

export function exportPresetsToJson(presets: Preset[]): string {
  return JSON.stringify({ version: 1, presets }, null, 2);
}

export function importPresetsFromJson(
  json: string,
  existing: Preset[]
): { presets: Preset[]; added: number; skipped: number } {
  const parsed = JSON.parse(json);
  if (!parsed || !Array.isArray(parsed.presets)) {
    throw new Error("Format invalide");
  }

  const incoming = parsed.presets as Preset[];
  const existingIds = new Set(existing.map((p) => p.id));
  const existingNames = new Set(existing.map((p) => p.name));

  let added = 0;
  let skipped = 0;
  const merged = [...existing];

  for (const preset of incoming) {
    // Skip if same id already exists
    if (existingIds.has(preset.id)) {
      skipped++;
      continue;
    }
    // Rename if name conflicts
    let name = preset.name;
    if (existingNames.has(name)) {
      let suffix = 2;
      while (existingNames.has(`${name} (${suffix})`)) suffix++;
      name = `${name} (${suffix})`;
    }
    merged.push({ ...preset, name });
    existingNames.add(name);
    added++;
  }

  return { presets: merged, added, skipped };
}
