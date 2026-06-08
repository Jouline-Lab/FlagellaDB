import {
  combinedGeneKeyFromParts,
  normalizeFlagellaFigureGeneKey
} from "@/lib/flagellaFigureGeneMap";

const ABSENT_FILL = "#ffffff";
const LABEL_TEXT_ABSENT = "#111111";
const LABEL_TEXT_PRESENT = "#ffffff";
const ABSENT_STROKE = "#cbd5e1";
const FOCUS_STROKE_ABSENT = "#64748b";

/** Use the same color token as the species table header on the page. */
export const SPECIES_TABLE_HEADER_FILL_FALLBACK = "#1a2c58";
const LIGHTEN_WEIGHT = 0.26;

function parseColor(value: string): [number, number, number] | null {
  const hex = value.trim();
  if (hex.startsWith("#")) {
    const normalized = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) return null;
    return [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16)
    ];
  }
  const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  return null;
}

function toRgb([r, g, b]: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function mixColor(base: string, other: string, otherWeight: number): string {
  const a = parseColor(base);
  const b = parseColor(other);
  if (!a || !b) return base;
  const aw = 1 - otherWeight;
  return toRgb([
    a[0] * aw + b[0] * otherWeight,
    a[1] * aw + b[1] * otherWeight,
    a[2] * aw + b[2] * otherWeight
  ]);
}

export function readSpeciesTableHeaderFill(): string {
  if (typeof document === "undefined") return SPECIES_TABLE_HEADER_FILL_FALLBACK;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--table-header-bg")
    .trim();
  const parsed = parseColor(raw);
  const solid = parsed ? toRgb(parsed) : SPECIES_TABLE_HEADER_FILL_FALLBACK;
  return mixColor(solid, "#ffffff", LIGHTEN_WEIGHT);
}

export function figureGeneFill(isPresent: boolean, fillColor: string): string {
  if (!isPresent) return ABSENT_FILL;
  return fillColor || SPECIES_TABLE_HEADER_FILL_FALLBACK;
}

export function figureTextLabelKeys(geneKeys: readonly string[]): string[] {
  const keys = [...geneKeys];
  if (combinedGeneKeyFromParts(geneKeys) === "motx|moty") {
    keys.push("motyx");
  }
  return [...new Set(keys.map(normalizeFlagellaFigureGeneKey))];
}

export function indexFigureTextLabels(svgDoc: Document): Map<string, SVGTextElement[]> {
  const index = new Map<string, SVGTextElement[]>();
  for (const text of svgDoc.querySelectorAll<SVGTextElement>("text")) {
    const content = text.textContent?.replace(/\s+/g, "") ?? "";
    const key = normalizeFlagellaFigureGeneKey(content);
    if (!key || key === "dna" || key === "rna") continue;
    const list = index.get(key) ?? [];
    list.push(text);
    index.set(key, list);
  }
  return index;
}

export function applyFigureTextColors(
  textIndex: Map<string, SVGTextElement[]>,
  presentLabelKeys: ReadonlySet<string>
): void {
  for (const [key, texts] of textIndex.entries()) {
    const fill = presentLabelKeys.has(key) ? LABEL_TEXT_PRESENT : LABEL_TEXT_ABSENT;
    for (const text of texts) {
      text.style.setProperty("fill", fill, "important");
      for (const tspan of text.querySelectorAll<SVGTSpanElement>("tspan")) {
        tspan.style.setProperty("fill", fill, "important");
      }
    }
  }
}

export function figureShapeStroke(
  fill: string,
  isFocused: boolean,
  isPresent: boolean
): { stroke: string; strokeWidth: string; fill: string } {
  if (!isPresent) {
    return {
      fill,
      stroke: isFocused ? mixColor(fill, "#000000", 0.32) : ABSENT_STROKE,
      strokeWidth: isFocused ? "1.4" : "1"
    };
  }

  const focusFill = isFocused ? mixColor(fill, "#ffffff", 0.12) : fill;
  const focusStroke = isFocused ? mixColor(fill, "#000000", 0.34) : mixColor(fill, "#000000", 0.24);

  return {
    fill: focusFill,
    stroke: focusStroke,
    strokeWidth: isFocused ? "1.5" : "1.1"
  };
}
