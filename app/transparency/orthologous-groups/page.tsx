import type { Metadata } from "next";
import { Suspense } from "react";
import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";
import OrthologousGroupViewer from "@/components/orthologous-groups/OrthologousGroupViewer";

export const metadata: Metadata = {
  title: "Orthologous Groups | Flagella DB",
  description: "How the members of each flagellar orthologous group were extracted from their search trees.",
  robots: { index: false, follow: false, nocache: true }
};

export default function OrthologousGroupsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Orthologous Group Extraction"
        description={
          "How the members of each of the 81 flagellar orthologous groups were taken from its homology " +
          "search. Every track shares one x-axis, the leaf order of the score-ordered search tree, with the " +
          "highest-scoring sequences on the left. The extracted orthologous clade is tinted across all " +
          "tracks. Where members of other flagellar groups fall in the same tree they are shown at the top, " +
          "with the groups most often encoded within 500 bp below them. Hover over one of those rows to see " +
          "how many of that group's sequences fall inside this group's clade, that is, are assigned to both. " +
          "FliF, FliH, MotB and FlrC were also searched a second time (FliF2, FliH2, MotB2, FlgR), and the " +
          "clade of that alternative run was added to their membership. Each run is shown on its own, with the " +
          "other run's extraction as the top row."
        }
      />
      <Suspense fallback={null}>
        <OrthologousGroupViewer />
      </Suspense>
    </PageShell>
  );
}
