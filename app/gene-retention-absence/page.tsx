import GeneRetentionAbsenceClient from "@/components/GeneRetentionAbsenceClient";
import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";

export default function GeneRetentionAbsencePage() {
  return (
    <PageShell>
      <PageHeader
        className="page-header-prominent"
        title="Gene Retention and Absence"
        description={
          <span className="text-[var(--text)]">
            Generate retention and absence summaries for flagellar genes using the phyletic
            distribution table. The first pass focuses on retained-gene counts, gene-level absence,
            and lineage-level absence.
          </span>
        }
      />
      <GeneRetentionAbsenceClient />
    </PageShell>
  );
}
