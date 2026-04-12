import { optimize } from "svgo";
import type { PluginState, GlobalOptions } from "./settings";
import { PLUGIN_DEFS } from "./plugins";

export interface OptimizeResult {
  data: string;
  originalSize: number;
  optimizedSize: number;
  savings: number; // percentage
}

// Plugins that accept floatPrecision as a param.
const FLOAT_PRECISION_PLUGINS = new Set([
  "cleanupNumericValues",
  "cleanupListOfValues",
  "convertPathData",
  "convertTransform",
  "convertShapeToPath",
  "mergePaths",
]);

// Plugins that accept transformPrecision as a param.
const TRANSFORM_PRECISION_PLUGINS = new Set([
  "convertPathData",
  "convertTransform",
]);

export function optimizeSvg(
  svgString: string,
  pluginStates: PluginState,
  globalOptions: GlobalOptions
): OptimizeResult {
  const originalSize = new Blob([svgString]).size;

  const { floatPrecision, transformPrecision } = globalOptions;

  // Build plugin configs — inject precision params where applicable.
  const plugins = PLUGIN_DEFS.filter((def) => {
    const state = pluginStates[def.name];
    return state !== undefined ? state : def.defaultEnabled;
  }).map((def): string | { name: string; params: Record<string, number> } => {
    const params: Record<string, number> = {};
    if (FLOAT_PRECISION_PLUGINS.has(def.name)) {
      params.floatPrecision = floatPrecision;
    }
    if (TRANSFORM_PRECISION_PLUGINS.has(def.name)) {
      params.transformPrecision = transformPrecision;
    }
    if (Object.keys(params).length > 0) {
      return { name: def.name, params };
    }
    return def.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  const result = optimize(svgString, {
    plugins,
    multipass: globalOptions.multipass,
    js2svg: {
      pretty: globalOptions.pretty,
      indent: globalOptions.indent,
    },
  });

  const optimizedSize = new Blob([result.data]).size;
  const savings =
    originalSize > 0
      ? Math.round(((originalSize - optimizedSize) / originalSize) * 100 * 10) / 10
      : 0;

  return {
    data: result.data,
    originalSize,
    optimizedSize,
    savings,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}
