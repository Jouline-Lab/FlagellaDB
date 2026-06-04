import type { SpeciesSuggestion } from "@/lib/speciesData";
import { normalizeAssemblyQuery, normalizeSpeciesQuery } from "@/lib/speciesNaming";

export const SPECIES_SEARCH_PLACEHOLDER_HERO =
  "Search by species name or assembly ID (e.g., Escherichia coli, GCA_003697165.2)";

export const SPECIES_SEARCH_PLACEHOLDER_COMPACT = "Species name or assembly ID…";

export const SPECIES_SEARCH_PLACEHOLDER_LOGO = "Add species by name or assembly ID…";

export const SPECIES_SEARCH_ARIA_LABEL = "Search species by name or assembly ID";

export function findBestSpeciesSuggestionMatch(
  query: string,
  suggestions: SpeciesSuggestion[]
): SpeciesSuggestion | undefined {
  if (suggestions.length === 0) {
    return undefined;
  }

  const normalizedQuery = normalizeSpeciesQuery(query);
  const normalizedAssemblyQuery = normalizeAssemblyQuery(query);

  if (!normalizedQuery) {
    return suggestions[0];
  }

  return (
    suggestions.find((item) => normalizeSpeciesQuery(item.name) === normalizedQuery) ??
    suggestions.find(
      (item) =>
        item.ncbiOrganismName &&
        normalizeSpeciesQuery(item.ncbiOrganismName) === normalizedQuery
    ) ??
    suggestions.find(
      (item) =>
        item.assembly && normalizeAssemblyQuery(item.assembly) === normalizedAssemblyQuery
    ) ??
    suggestions.find(
      (item) =>
        item.assembly &&
        normalizeAssemblyQuery(item.assembly).includes(normalizedAssemblyQuery)
    ) ??
    suggestions[0]
  );
}
