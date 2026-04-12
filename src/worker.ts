import { analyzeSvg, type SvgAnalysis } from "./analysis";
import { optimizeSvg, type OptimizeResult } from "./optimizer";
import type { GlobalOptions, PluginState } from "./settings";

interface OptimizeWorkerRequest {
  kind: "optimize";
  id: number;
  svgString: string;
  pluginStates: PluginState;
  globalOptions: GlobalOptions;
}

interface AnalyzeWorkerRequest {
  kind: "analyze";
  id: number;
  svgString: string;
}

export type WorkerRequest = OptimizeWorkerRequest | AnalyzeWorkerRequest;

export type OptimizeWorkerResponse =
  | { kind: "optimize"; id: number; success: true; result: OptimizeResult }
  | { kind: "optimize"; id: number; success: false; error: string };

export type AnalyzeWorkerResponse =
  | { kind: "analyze"; id: number; success: true; result: SvgAnalysis }
  | { kind: "analyze"; id: number; success: false; error: string };

export type WorkerResponse = OptimizeWorkerResponse | AnalyzeWorkerResponse;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, svgString } = e.data;
  try {
    if (e.data.kind === "optimize") {
      const result = optimizeSvg(svgString, e.data.pluginStates, e.data.globalOptions);
      const response: OptimizeWorkerResponse = { kind: "optimize", id, success: true, result };
      self.postMessage(response);
      return;
    }

    const result = analyzeSvg(svgString);
    const response: AnalyzeWorkerResponse = { kind: "analyze", id, success: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse =
      e.data.kind === "optimize"
        ? { kind: "optimize", id, success: false, error: String(err) }
        : { kind: "analyze", id, success: false, error: String(err) };
    self.postMessage(response);
  }
};
