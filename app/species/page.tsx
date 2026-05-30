import { Suspense } from "react";
import SpeciesIndexClient from "@/components/species/SpeciesIndexClient";

export default function SpeciesIndexPage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <div className="container species-page">
            <div className="species-loading-state" role="status" aria-live="polite">
              <p className="species-loading-title">Loading...</p>
              <span className="species-loading-spinner" aria-hidden="true" />
              <p className="species-loading-subtitle">Please wait a moment.</p>
            </div>
          </div>
        </main>
      }
    >
      <SpeciesIndexClient />
    </Suspense>
  );
}
