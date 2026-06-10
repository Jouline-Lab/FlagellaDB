/**
 * Gene coverage notes for flagellum_figure_database.svg (species interactive figure).
 * These DB genes have no labeled shape in the figure yet — tracked for a future figure update.
 */
export const FLAGELLA_FIGURE_MISSING_DB_GENES = [] as const;

/** Labels present in the figure but absent from the phyletic distribution TSV. */
export const FLAGELLA_FIGURE_EXTRA_LABELS = [] as const;

/**
 * Single SVG shapes that represent multiple database genes.
 * Keys are normalized gene keys joined with "|" (sorted).
 */
export const FLAGELLA_FIGURE_COMBINED_GENE_KEYS: Record<string, readonly string[]> = {
  "motx|moty": ["MotX", "MotY"]
};

export function normalizeFlagellaFigureGeneKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseFigureGeneKeys(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const keys = trimmed
    .split(/[,|/]/)
    .map((part) => normalizeFlagellaFigureGeneKey(part))
    .filter(Boolean);

  const expanded = [...keys];
  // Some SVG exports encode combined MotX/MotY as one token.
  if (expanded.includes("motxmoty") && !expanded.includes("motx") && !expanded.includes("moty")) {
    expanded.push("motx", "moty");
  }

  const unique = [...new Set(expanded.filter((key) => key !== "motxmoty"))];
  const combinedKey = unique.sort().join("|");
  const combined = FLAGELLA_FIGURE_COMBINED_GENE_KEYS[combinedKey];
  if (combined) {
    return combined.map(normalizeFlagellaFigureGeneKey);
  }

  return unique;
}

export function combinedGeneKeyFromParts(parts: readonly string[]): string {
  return parts.map(normalizeFlagellaFigureGeneKey).sort().join("|");
}

export function resolveFigureGeneKeys(rawGene: string): string[] {
  return parseFigureGeneKeys(rawGene);
}

export function countForFigureGeneKeys(
  geneKeys: readonly string[],
  geneInfoByKey: ReadonlyMap<string, { count: number }>
): number {
  let total = 0;
  for (const key of geneKeys) {
    total += geneInfoByKey.get(key)?.count ?? 0;
  }
  return total;
}

export function primaryFigureGeneKey(geneKeys: readonly string[]): string {
  return geneKeys[0] ?? "";
}

export function logFlagellaFigureGeneCoverage(
  geneInfoByKey: ReadonlyMap<string, { count: number }>
): void {
  const missingPresent = FLAGELLA_FIGURE_MISSING_DB_GENES.filter((gene) =>
    geneInfoByKey.has(normalizeFlagellaFigureGeneKey(gene))
  );
  const missingAbsent = FLAGELLA_FIGURE_MISSING_DB_GENES.filter(
    (gene) => !geneInfoByKey.has(normalizeFlagellaFigureGeneKey(gene))
  );

  console.info("[Flagella figure] DB genes without a labeled shape:", FLAGELLA_FIGURE_MISSING_DB_GENES.join(", "));
  if (missingPresent.length > 0) {
    console.info(
      "[Flagella figure] Missing shapes but present in this species:",
      missingPresent.join(", ")
    );
  }
  if (missingAbsent.length > 0) {
    console.info(
      "[Flagella figure] Missing shapes and absent in this species:",
      missingAbsent.join(", ")
    );
  }
  if (FLAGELLA_FIGURE_EXTRA_LABELS.length > 0) {
    console.info(
      "[Flagella figure] Figure-only labels (not in DB):",
      FLAGELLA_FIGURE_EXTRA_LABELS.join(", ")
    );
  }
}
