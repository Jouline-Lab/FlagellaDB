import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";

export default function FaqPage() {
  return (
    <PageShell>
      <PageHeader
        className="page-header-prominent"
        title="Frequently Asked Questions"
        description="This page is reserved for frequently asked questions."
      />
    </PageShell>
  );
}
