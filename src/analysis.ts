import { parseSvg } from "svgo/lib/parser.js";
import type { XastChild, XastElement, XastRoot } from "svgo/lib/types";

export interface AnalysisBucket {
  name: string;
  count: number;
  directBytes: number;
  subtreeBytes: number;
}

export interface AttributeBucket {
  name: string;
  count: number;
  bytes: number;
}

export interface HeavyNode {
  selector: string;
  label: string;
  tagName: string;
  bytes: number;
  note?: string;
  rasterizable: boolean;
  pathDataBytes?: number;
}

export interface EmbeddedRaster {
  selector: string;
  tagName: string;
  mimeType: string;
  encoding: "base64" | "url-encoded" | "plain";
  sourceBytes: number;
  decodedBytes: number | null;
  width: number | null;
  height: number | null;
  managedByTool: boolean;
  sourceSelector: string | null;
  rasterFormat: "png" | "webp" | null;
  rasterScale: number | null;
  rasterQuality: number | null;
}

export interface SvgAnalysis {
  normalizedSize: number;
  elementCount: number;
  tagBreakdown: AnalysisBucket[];
  attributeBreakdown: AttributeBucket[];
  heavyNodes: HeavyNode[];
  embeddedRasters: EmbeddedRaster[];
  numericLiteralHistogram: number[];
}

interface MutableBucket {
  name: string;
  count: number;
  directBytes: number;
  subtreeBytes: number;
}

interface MutableAttributeBucket {
  name: string;
  count: number;
  bytes: number;
}

const encoder = new TextEncoder();
const TEXT_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "'": "&apos;",
  '"': "&quot;",
  ">": "&gt;",
  "<": "&lt;",
};
const ATTRIBUTE_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  ">": "&gt;",
  "<": "&lt;",
};
const DECIMAL_LITERAL_RE = /-?(?:\d*\.\d+|\d+\.\d*)(?:e[-+]?\d+)?/gi;

export function analyzeSvg(svgString: string): SvgAnalysis {
  const root = parseSvg(svgString) as XastRoot;
  const tagBuckets = new Map<string, MutableBucket>();
  const attributeBuckets = new Map<string, MutableAttributeBucket>();
  const heavyNodes: HeavyNode[] = [];
  const embeddedRasters: EmbeddedRaster[] = [];
  const numericLiteralHistogram: number[] = [];
  let elementCount = 0;

  const siblingCounters = new Map<string, number>();
  let normalizedSize = 0;

  for (const child of root.children) {
    if (child.type === "element") {
      const nextIndex = (siblingCounters.get(child.name) ?? 0) + 1;
      siblingCounters.set(child.name, nextIndex);
      normalizedSize += walkNode(
        child,
        `${child.name}[${nextIndex}]`,
        tagBuckets,
        attributeBuckets,
        heavyNodes,
        embeddedRasters,
        numericLiteralHistogram,
        () => {
          elementCount += 1;
        }
      );
      continue;
    }

    normalizedSize += walkLeafNode(child, tagBuckets);
  }

  return {
    normalizedSize,
    elementCount,
    tagBreakdown: sortBuckets(tagBuckets),
    attributeBreakdown: sortAttributeBuckets(attributeBuckets),
    heavyNodes: heavyNodes.sort((a, b) => b.bytes - a.bytes).slice(0, 12),
    embeddedRasters: embeddedRasters.sort((a, b) => b.sourceBytes - a.sourceBytes),
    numericLiteralHistogram,
  };
}

function walkNode(
  node: XastElement,
  selector: string,
  tagBuckets: Map<string, MutableBucket>,
  attributeBuckets: Map<string, MutableAttributeBucket>,
  heavyNodes: HeavyNode[],
  embeddedRasters: EmbeddedRaster[],
  numericLiteralHistogram: number[],
  onElement: () => void
): number {
  onElement();

  let attributeBytes = 0;

  for (const [name, value] of Object.entries(node.attributes)) {
    const serialized = ` ${name}="${escapeAttribute(value)}"`;
    const bytes = byteLength(serialized);
    attributeBytes += bytes;
    addAttributeBucket(attributeBuckets, name, bytes);

    if (!value.startsWith("data:")) {
      collectNumericLiterals(value, numericLiteralHistogram);
    }
  }

  const childCounters = new Map<string, number>();
  let childrenBytes = 0;

  for (const child of node.children) {
    if (child.type === "element") {
      const nextIndex = (childCounters.get(child.name) ?? 0) + 1;
      childCounters.set(child.name, nextIndex);
      childrenBytes += walkNode(
        child,
        `${selector} > ${child.name}[${nextIndex}]`,
        tagBuckets,
        attributeBuckets,
        heavyNodes,
        embeddedRasters,
        numericLiteralHistogram,
        onElement
      );
      continue;
    }

    childrenBytes += walkLeafNode(child, tagBuckets);
  }

  const isSelfClosing = node.children.length === 0;
  const directBytes = isSelfClosing
    ? byteLength(`<${node.name}${serializeAttributes(node.attributes)}/>`) 
    : byteLength(`<${node.name}${serializeAttributes(node.attributes)}>` ) +
        byteLength(`</${node.name}>`);
  const subtreeBytes = directBytes + childrenBytes;

  addTagBucket(tagBuckets, node.name, directBytes, subtreeBytes);
  heavyNodes.push({
    selector,
    label: buildElementLabel(node),
    tagName: node.name,
    bytes: subtreeBytes,
    note: buildNodeNote(node, subtreeBytes, attributeBytes),
    rasterizable: node.name === "path" && typeof node.attributes.d === "string",
    pathDataBytes:
      node.name === "path" && typeof node.attributes.d === "string"
        ? byteLength(node.attributes.d)
        : undefined,
  });

  const href = node.attributes.href ?? node.attributes["xlink:href"];
  if (href) {
    const raster = analyzeRasterHref(href, selector, node);
    if (raster) embeddedRasters.push(raster);
  }

  return subtreeBytes;
}

function walkLeafNode(
  node: Exclude<XastChild, XastElement>,
  tagBuckets: Map<string, MutableBucket>
): number {
  let bucketName = "#text";
  let bytes = 0;

  switch (node.type) {
    case "text":
      bytes = byteLength(escapeText(node.value));
      bucketName = "#text";
      break;
    case "comment":
      bytes = byteLength(`<!--${node.value}-->`);
      bucketName = "#comment";
      break;
    case "cdata":
      bytes = byteLength(`<![CDATA[${node.value}]]>`);
      bucketName = "#cdata";
      break;
    case "doctype":
      bytes = byteLength(`<!DOCTYPE${node.data.doctype}>`);
      bucketName = "#doctype";
      break;
    case "instruction":
      bytes = byteLength(`<?${node.name} ${node.value}?>`);
      bucketName = "#instruction";
      break;
  }

  addTagBucket(tagBuckets, bucketName, bytes, bytes);
  return bytes;
}

function addTagBucket(
  buckets: Map<string, MutableBucket>,
  name: string,
  directBytes: number,
  subtreeBytes: number
): void {
  const bucket = buckets.get(name) ?? {
    name,
    count: 0,
    directBytes: 0,
    subtreeBytes: 0,
  };
  bucket.count += 1;
  bucket.directBytes += directBytes;
  bucket.subtreeBytes += subtreeBytes;
  buckets.set(name, bucket);
}

function addAttributeBucket(
  buckets: Map<string, MutableAttributeBucket>,
  name: string,
  bytes: number
): void {
  const bucket = buckets.get(name) ?? {
    name,
    count: 0,
    bytes: 0,
  };
  bucket.count += 1;
  bucket.bytes += bytes;
  buckets.set(name, bucket);
}

function sortBuckets(buckets: Map<string, MutableBucket>): AnalysisBucket[] {
  return [...buckets.values()].sort((a, b) => b.directBytes - a.directBytes);
}

function sortAttributeBuckets(buckets: Map<string, MutableAttributeBucket>): AttributeBucket[] {
  return [...buckets.values()].sort((a, b) => b.bytes - a.bytes);
}

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function escapeText(value: string): string {
  return value.replace(/[&'"<>]/g, (char) => TEXT_ENTITIES[char] ?? char);
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (char) => ATTRIBUTE_ENTITIES[char] ?? char);
}

function serializeAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

function buildElementLabel(node: XastElement): string {
  const id = node.attributes.id ? `#${node.attributes.id}` : "";
  const className = node.attributes.class
    ? `.${node.attributes.class.trim().split(/\s+/).filter(Boolean).join(".")}`
    : "";
  return `<${node.name}${id}${className}>`;
}

function buildNodeNote(node: XastElement, subtreeBytes: number, attributeBytes: number): string | undefined {
  if (node.name === "path" && node.attributes.d) {
    return `d=${formatCompactBytes(byteLength(node.attributes.d))}`;
  }
  if ((node.name === "image" || node.name === "feImage") && attributeBytes > 0) {
    return `attributs=${formatCompactBytes(attributeBytes)}`;
  }
  if (node.name === "style" && subtreeBytes > 0) {
    return `bloc=${formatCompactBytes(subtreeBytes)}`;
  }
  return undefined;
}

function analyzeRasterHref(
  href: string,
  selector: string,
  node: XastElement
): EmbeddedRaster | null {
  if (!href.startsWith("data:image/")) return null;

  const commaIdx = href.indexOf(",");
  if (commaIdx === -1) return null;

  const header = href.slice(5, commaIdx);
  const payload = href.slice(commaIdx + 1);
  const mimeType = header.split(";")[0].toLowerCase();

  if (mimeType === "image/svg+xml") return null;

  const isBase64 = /;base64(?:;|$)/i.test(header);
  const encoding: EmbeddedRaster["encoding"] = isBase64
    ? "base64"
    : /;charset=|;utf-8|%/i.test(payload)
      ? "url-encoded"
      : "plain";

  let decodedBytes: number | null = null;
  try {
    if (isBase64) {
      decodedBytes = atob(payload).length;
    } else if (encoding === "url-encoded") {
      decodedBytes = byteLength(decodeURIComponent(payload));
    } else {
      decodedBytes = byteLength(payload);
    }
  } catch {
    decodedBytes = null;
  }

  return {
    selector,
    tagName: node.name,
    mimeType,
    encoding,
    sourceBytes: byteLength(href),
    decodedBytes,
    width: parseDimension(node.attributes.width),
    height: parseDimension(node.attributes.height),
    managedByTool: Boolean(node.attributes["data-raster-selector"]),
    sourceSelector: node.attributes["data-raster-selector"] ?? null,
    rasterFormat: parseRasterFormat(node.attributes["data-raster-format"]),
    rasterScale: parseRasterNumber(node.attributes["data-raster-scale"]),
    rasterQuality: parseRasterNumber(node.attributes["data-raster-quality"]),
  };
}

function parseDimension(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?\d*\.?\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRasterNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRasterFormat(value: string | undefined): EmbeddedRaster["rasterFormat"] {
  return value === "png" || value === "webp" ? value : null;
}

function collectNumericLiterals(value: string, histogram: number[]): void {
  DECIMAL_LITERAL_RE.lastIndex = 0;
  let match = DECIMAL_LITERAL_RE.exec(value);
  while (match) {
    const decimalPart = match[0].match(/\.(\d+)/);
    const decimals = decimalPart?.[1].length ?? 0;
    if (decimals > 0) {
      histogram[decimals] = (histogram[decimals] ?? 0) + 1;
    }
    match = DECIMAL_LITERAL_RE.exec(value);
  }
}

function formatCompactBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} Ko`;
}
