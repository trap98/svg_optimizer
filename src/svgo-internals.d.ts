declare module "svgo/lib/parser.js" {
  import type { XastRoot } from "svgo/lib/types";

  export function parseSvg(data: string, from?: string): XastRoot;
}
