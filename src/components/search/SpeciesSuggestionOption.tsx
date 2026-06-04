import type { SpeciesSuggestion } from "@/lib/speciesData";

type SpeciesSuggestionOptionProps = {
  item: SpeciesSuggestion;
};

export default function SpeciesSuggestionOption({ item }: SpeciesSuggestionOptionProps) {
  return (
    <>
      <span className="autocomplete-item-label">{item.name}</span>
      {item.assembly ? <span className="autocomplete-item-meta">{item.assembly}</span> : null}
    </>
  );
}
