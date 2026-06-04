import {
  formatSpeciesName,
  normalizeAssemblyQuery,
  normalizeSpeciesQuery,
  speciesNameToSlug,
  stripTaxonomyPrefix
} from "@/lib/speciesNaming";
import { withBasePath } from "@/lib/assetPaths";
import type { SpeciesProfile, SpeciesSuggestion } from "@/lib/speciesData";

const TAXONOMY_RANKS = [
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species"
] as const;

type TaxonomyIndex = {
  version: number;
  ranks: string[];
  rows: string[][];
};

export type { SpeciesProfile, SpeciesSuggestion } from "@/lib/speciesData";

let taxonomyIndexPromise: Promise<TaxonomyIndex> | null = null;
let speciesProfilesPromise: Promise<SpeciesProfile[]> | null = null;

function cleanTaxonomyValue(value: string): string {
  return stripTaxonomyPrefix(value) || "-";
}

function rankIndex(ranks: string[], rank: string): number {
  return ranks.indexOf(rank);
}

async function loadTaxonomyIndex(): Promise<TaxonomyIndex> {
  if (!taxonomyIndexPromise) {
    taxonomyIndexPromise = fetch(withBasePath("/taxonomy-index.json")).then(async (response) => {
      if (!response.ok) {
        throw new Error("Failed to load taxonomy index.");
      }

      return (await response.json()) as TaxonomyIndex;
    });
  }

  return taxonomyIndexPromise;
}

async function loadSpeciesProfiles(): Promise<SpeciesProfile[]> {
  if (!speciesProfilesPromise) {
    speciesProfilesPromise = loadTaxonomyIndex().then((taxonomyIndex) => {
      const speciesRankIndex = rankIndex(taxonomyIndex.ranks, "species");
      const phylumRankIndex = rankIndex(taxonomyIndex.ranks, "phylum");
      const classRankIndex = rankIndex(taxonomyIndex.ranks, "class");
      const orderRankIndex = rankIndex(taxonomyIndex.ranks, "order");
      const familyRankIndex = rankIndex(taxonomyIndex.ranks, "family");
      const genusRankIndex = rankIndex(taxonomyIndex.ranks, "genus");
      const nameRankIndex = rankIndex(taxonomyIndex.ranks, "name");
      const assemblyRankIndex = rankIndex(taxonomyIndex.ranks, "assembly");

      if (
        speciesRankIndex < 0 ||
        phylumRankIndex < 0 ||
        classRankIndex < 0 ||
        orderRankIndex < 0 ||
        familyRankIndex < 0 ||
        genusRankIndex < 0
      ) {
        return [];
      }

      const rowsBySlug = new Map<string, SpeciesProfile>();

      for (const row of taxonomyIndex.rows) {
        if (!Array.isArray(row) || row.length !== taxonomyIndex.ranks.length) {
          continue;
        }

        const rawSpecies = (row[speciesRankIndex] ?? "").trim();
        if (!rawSpecies || rawSpecies === "-") {
          continue;
        }

        const name = formatSpeciesName(rawSpecies);
        if (!name) {
          continue;
        }

        const slug = speciesNameToSlug(name);
        if (rowsBySlug.has(slug)) {
          continue;
        }

        rowsBySlug.set(slug, {
          name,
          slug,
          ncbiOrganismName:
            nameRankIndex >= 0 ? (row[nameRankIndex] ?? "").trim() || undefined : undefined,
          assembly:
            assemblyRankIndex >= 0 ? (row[assemblyRankIndex] ?? "").trim() || undefined : undefined,
          taxonomy: {
            phylum: cleanTaxonomyValue(row[phylumRankIndex] ?? ""),
            className: cleanTaxonomyValue(row[classRankIndex] ?? ""),
            order: cleanTaxonomyValue(row[orderRankIndex] ?? ""),
            family: cleanTaxonomyValue(row[familyRankIndex] ?? ""),
            genus: cleanTaxonomyValue(row[genusRankIndex] ?? "")
          },
          summary: "",
          traits: []
        });
      }

      return Array.from(rowsBySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  return speciesProfilesPromise;
}

function rowMatchesSpeciesQuery(
  row: string[],
  ranks: string[],
  normalizedQuery: string
): boolean {
  const speciesRankIndex = rankIndex(ranks, "species");
  const nameRankIndex = rankIndex(ranks, "name");
  const assemblyRankIndex = rankIndex(ranks, "assembly");

  const scientificName =
    speciesRankIndex >= 0
      ? normalizeSpeciesQuery(formatSpeciesName((row[speciesRankIndex] ?? "").trim()))
      : "";
  const ncbiOrganismName =
    nameRankIndex >= 0 ? normalizeSpeciesQuery((row[nameRankIndex] ?? "").trim()) : "";
  const assembly =
    assemblyRankIndex >= 0 ? normalizeAssemblyQuery((row[assemblyRankIndex] ?? "").trim()) : "";

  return (
    (scientificName && scientificName.includes(normalizedQuery)) ||
    (ncbiOrganismName && ncbiOrganismName.includes(normalizedQuery)) ||
    (assembly && assembly.includes(normalizeAssemblyQuery(normalizedQuery)))
  );
}

export async function getSpeciesSuggestionsClient(
  query: string,
  limit = 20
): Promise<SpeciesSuggestion[]> {
  const taxonomyIndex = await loadTaxonomyIndex();
  const speciesRankIndex = rankIndex(taxonomyIndex.ranks, "species");
  const nameRankIndex = rankIndex(taxonomyIndex.ranks, "name");
  const assemblyRankIndex = rankIndex(taxonomyIndex.ranks, "assembly");

  if (speciesRankIndex < 0) {
    return [];
  }

  const normalizedQuery = normalizeSpeciesQuery(query);
  const suggestions: SpeciesSuggestion[] = [];
  const seenKeys = new Set<string>();

  for (const row of taxonomyIndex.rows) {
    if (!Array.isArray(row) || row.length !== taxonomyIndex.ranks.length) {
      continue;
    }

    if (normalizedQuery && !rowMatchesSpeciesQuery(row, taxonomyIndex.ranks, normalizedQuery)) {
      continue;
    }

    const rawSpecies = (row[speciesRankIndex] ?? "").trim();
    if (!rawSpecies || rawSpecies === "-") {
      continue;
    }

    const name = formatSpeciesName(rawSpecies);
    if (!name) {
      continue;
    }

    const slug = speciesNameToSlug(name);
    const assembly =
      assemblyRankIndex >= 0 ? (row[assemblyRankIndex] ?? "").trim() || undefined : undefined;
    const dedupeKey = assembly ? `${slug}\t${assembly}` : slug;

    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    seenKeys.add(dedupeKey);

    suggestions.push({
      name,
      slug,
      ncbiOrganismName:
        nameRankIndex >= 0 ? (row[nameRankIndex] ?? "").trim() || undefined : undefined,
      assembly
    });

    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
}

export async function getAllSpeciesProfilesClient(): Promise<SpeciesProfile[]> {
  return loadSpeciesProfiles();
}
