/** Core sequence-logo palette (matches SequenceLogoChart aminoAcidGroups). */
export const LOGO_REPRESENTATION_COLORS = [
  "#FCB315",
  "#7CAEC4",
  "#DD6030",
  "#231F20",
  "#7D2985",
  "#B4B4B4"
] as const;

/**
 * Two extensions harmonized with the logo palette (sage + warm ochre) so all
 * eight flagellar categories get a unique swatch without repeating logo hues.
 */
export const FLAGELLA_CATEGORY_EXTENSION_COLORS = ["#6AAF78", "#A8864E"] as const;

/** Functional categories shown on species pages (stable display order). */
export const FLAGELLA_CATEGORY_ORDER = [
  "Basal body & hook",
  "LP-ring & assembly",
  "Motor & switch",
  "Export apparatus",
  "Filament & junction",
  "Regulation",
  "Chaperones & assembly factors",
  "Other flagella-associated genes"
] as const;

export type FlagellaFunctionalCategory = (typeof FLAGELLA_CATEGORY_ORDER)[number];

export const FLAGELLA_CATEGORY_COLORS: Record<FlagellaFunctionalCategory, string> = {
  "Basal body & hook": LOGO_REPRESENTATION_COLORS[0],
  "LP-ring & assembly": LOGO_REPRESENTATION_COLORS[1],
  "Motor & switch": LOGO_REPRESENTATION_COLORS[2],
  "Export apparatus": LOGO_REPRESENTATION_COLORS[3],
  "Filament & junction": LOGO_REPRESENTATION_COLORS[4],
  Regulation: LOGO_REPRESENTATION_COLORS[5],
  "Chaperones & assembly factors": FLAGELLA_CATEGORY_EXTENSION_COLORS[0],
  "Other flagella-associated genes": FLAGELLA_CATEGORY_EXTENSION_COLORS[1]
};

const CATEGORY_COLOR = new Map<string, string>(
  Object.entries(FLAGELLA_CATEGORY_COLORS) as Array<[string, string]>
);

/** Dark fill used for Export apparatus nodes on dark canvases (mirrors logo small-group handling). */
const EXPORT_APPARATUS_DARK = "#E8ECF4";

export function getFlagellaCategoryColor(category: string, isDarkMode = false): string {
  const base = CATEGORY_COLOR.get(category) ?? LOGO_REPRESENTATION_COLORS[5];
  if (isDarkMode && category === "Export apparatus" && base === "#231F20") {
    return EXPORT_APPARATUS_DARK;
  }
  return base;
}

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Blend two category colors for cross-category edges. */
export function blendCategoryColors(colorA: string, colorB: string, weightB = 0.5): string {
  const [r1, g1, b1] = parseHex(colorA);
  const [r2, g2, b2] = parseHex(colorB);
  const weightA = 1 - weightB;
  return toHex([
    Math.round(r1 * weightA + r2 * weightB),
    Math.round(g1 * weightA + g2 * weightB),
    Math.round(b1 * weightA + b2 * weightB)
  ]);
}

export function edgeColorForCategories(
  sourceCategory: string,
  targetCategory: string,
  isDarkMode = false
): string {
  const sourceColor = getFlagellaCategoryColor(sourceCategory, isDarkMode);
  const targetColor = getFlagellaCategoryColor(targetCategory, isDarkMode);
  if (sourceCategory === targetCategory) {
    return sourceColor;
  }
  return blendCategoryColors(sourceColor, targetColor);
}

export function isLightFillColor(hex: string): boolean {
  const [r, g, b] = parseHex(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62;
}

const LABEL_TEXT_BLACK_CATEGORIES = new Set<string>([
  FLAGELLA_CATEGORY_ORDER[FLAGELLA_CATEGORY_ORDER.length - 2],
  FLAGELLA_CATEGORY_ORDER[FLAGELLA_CATEGORY_ORDER.length - 1]
]);

/** Label color on category-filled nodes (network graphs). */
export function getFlagellaCategoryLabelTextColor(
  category: string,
  isDarkMode = false,
  themeLabelText = "#1f2430"
): string {
  if (LABEL_TEXT_BLACK_CATEGORIES.has(category)) {
    return "#000000";
  }
  const base = getFlagellaCategoryColor(category, isDarkMode);
  return isLightFillColor(base) ? themeLabelText : "#ffffff";
}
