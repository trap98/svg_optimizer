import { optimizeSvg, type OptimizeResult } from "./optimizer";
import type { PluginState, GlobalOptions } from "./settings";

interface WorkerRequest {
  id: number;
  svgString: string;
  pluginStates: PluginState;
  globalOptions: GlobalOptions;
}

type WorkerResponse =
  | { id: number; success: true; result: OptimizeResult }
  | { id: number; success: false; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, svgString, pluginStates, globalOptions } = e.data;
  try {
    const result = optimizeSvg(svgString, pluginStates, globalOptions);
    const response: WorkerResponse = { id, success: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = { id, success: false, error: String(err) };
    self.postMessage(response);
  }
};
