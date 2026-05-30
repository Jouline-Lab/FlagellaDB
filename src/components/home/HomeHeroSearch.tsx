"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ScopeSearchBar, { type SearchScope } from "@/components/search/ScopeSearchBar";
import { genePageHref, speciesPageHref } from "@/lib/pageEntityQuery";
import { geneNameToSlug } from "@/lib/flagellaGeneClassification";
import { speciesNameToSlug } from "@/lib/speciesNaming";
import { withBasePath } from "@/lib/assetPaths";

const modelSpecies = ["Escherichia coli", "Bacillus subtilis", "Pseudomonas aeruginosa"];
const modelGenes = ["FliG", "FlgB", "MotA"];

const HOME_STATS_PATH = "/home-stats.json";

type HomeStats = {
  totalProteinSequences: number | null;
  uniqueGeneFamilies: number | null;
  bacterialGenomeAssemblies: number | null;
  bacterialRowsWithAnyGeneCount: number | null;
};

type HomeStatsPayload = {
  totalProteinSequences?: number;
  uniqueGeneFamilies?: number;
  totalGenes?: number;
  bacterialGenomeAssemblies?: number;
  bacterialRowsWithAnyGeneCount?: number;
};

function formatCompactNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "…";
  }
  return value.toLocaleString();
}

export default function HomeHeroSearch() {
  const router = useRouter();
  const [scope, setScope] = useState<SearchScope>("species");
  const [stats, setStats] = useState<HomeStats>({
    totalProteinSequences: null,
    uniqueGeneFamilies: null,
    bacterialGenomeAssemblies: null,
    bacterialRowsWithAnyGeneCount: null
  });

  useEffect(() => {
    let cancelled = false;

    fetch(withBasePath(HOME_STATS_PATH))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load homepage stats (HTTP ${response.status}).`);
        }
        return response.json() as Promise<HomeStatsPayload>;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setStats((current) => ({
          ...current,
          totalProteinSequences: Number.isFinite(payload?.totalProteinSequences)
            ? Number(payload.totalProteinSequences)
            : null,
          uniqueGeneFamilies: Number.isFinite(payload?.uniqueGeneFamilies)
            ? Number(payload.uniqueGeneFamilies)
            : Number.isFinite(payload?.totalGenes)
              ? Number(payload.totalGenes)
              : null,
          bacterialGenomeAssemblies: Number.isFinite(payload?.bacterialGenomeAssemblies)
            ? Number(payload.bacterialGenomeAssemblies)
            : null,
          bacterialRowsWithAnyGeneCount: Number.isFinite(payload?.bacterialRowsWithAnyGeneCount)
            ? Number(payload.bacterialRowsWithAnyGeneCount)
            : null
        }));
      })
      .catch(() => {
        // Stats card just stays in its loading state if this fetch fails.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasAnyStat =
    stats.totalProteinSequences !== null ||
    stats.uniqueGeneFamilies !== null ||
    stats.bacterialGenomeAssemblies !== null ||
    stats.bacterialRowsWithAnyGeneCount !== null;

  return (
    <section className="hero">
      <div className="container hero-content hero-content-search-only">
        <p className="hero-search-title">
          {scope === "species" ? "Find Your Species" : "Find Your Gene"}
        </p>

        <ScopeSearchBar variant="hero" onScopeChange={setScope} />

        <div className="hero-model-organisms" aria-label="Example searches">
          <span className="hero-model-label">Examples:</span>
          <span className="hero-model-list">
            {scope === "species"
              ? modelSpecies.map((name, index) => (
                  <span key={name}>
                    <button
                      type="button"
                      className="hero-model-link"
                      onClick={() => router.push(speciesPageHref(speciesNameToSlug(name)))}
                    >
                      {name}
                    </button>
                    {index < modelSpecies.length - 1 ? (
                      <span className="hero-model-separator">, </span>
                    ) : null}
                  </span>
                ))
              : modelGenes.map((name, index) => (
                  <span key={name}>
                    <button
                      type="button"
                      className="hero-model-link"
                      onClick={() => router.push(genePageHref(geneNameToSlug(name)))}
                    >
                      {name}
                    </button>
                    {index < modelGenes.length - 1 ? (
                      <span className="hero-model-separator">, </span>
                    ) : null}
                  </span>
                ))}
          </span>
        </div>

        {hasAnyStat ? (
          <div className="hero-stats" aria-label="Database statistics">
            <div className="hero-stat-card">
              <span className="hero-stat-value">
                {formatCompactNumber(stats.totalProteinSequences)}
              </span>
              <span className="hero-stat-label">Flagella-associated protein sequences</span>
            </div>
            <div className="hero-stat-card">
              <span className="hero-stat-value">
                {formatCompactNumber(stats.uniqueGeneFamilies)}
              </span>
              <span className="hero-stat-label">Unique flagellar genes</span>
            </div>
            <div className="hero-stat-card">
              <span className="hero-stat-value">
                {`${formatCompactNumber(stats.bacterialRowsWithAnyGeneCount)} / ${formatCompactNumber(
                  stats.bacterialGenomeAssemblies
                )}`}
              </span>
              <span className="hero-stat-label">Bacterial genomes with flagellar genes</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
