import { PLUGIN_DEFS } from "./plugins";

export type PluginState = Record<string, boolean>;

export interface GlobalOptions {
  multipass: boolean;
  pretty: boolean;
  indent: number;
  floatPrecision: number;
  transformPrecision: number;
}

export const DEFAULT_GLOBAL_OPTIONS: GlobalOptions = {
  multipass: true,
  pretty: false,
  indent: 2,
  floatPrecision: 3,
  transformPrecision: 5,
};

const STORAGE_KEY_PLUGINS = "svgo-optimizer-plugin-states";
const STORAGE_KEY_GLOBALS = "svgo-optimizer-global-options";
const STORAGE_KEY_PREVIEW_CSS = "svgo-optimizer-preview-css";

export function loadPluginStates(): PluginState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLUGINS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as PluginState;
      }
    }
  } catch {
    // ignore
  }
  return getDefaultStates();
}

export function savePluginStates(states: PluginState): void {
  localStorage.setItem(STORAGE_KEY_PLUGINS, JSON.stringify(states));
}

export function getDefaultStates(): PluginState {
  const states: PluginState = {};
  for (const def of PLUGIN_DEFS) {
    states[def.name] = def.defaultEnabled;
  }
  return states;
}

export function loadGlobalOptions(): GlobalOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GLOBALS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        // Merge with defaults so new keys added later are picked up
        return { ...DEFAULT_GLOBAL_OPTIONS, ...parsed } as GlobalOptions;
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_GLOBAL_OPTIONS };
}

export function saveGlobalOptions(opts: GlobalOptions): void {
  localStorage.setItem(STORAGE_KEY_GLOBALS, JSON.stringify(opts));
}

export function loadPreviewCss(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_PREVIEW_CSS) ?? "";
  } catch {
    return "";
  }
}

export function savePreviewCss(value: string): void {
  localStorage.setItem(STORAGE_KEY_PREVIEW_CSS, value);
}
