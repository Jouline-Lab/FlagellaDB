import PageHeader from "@/components/layout/PageHeader";
import PageShell from "@/components/layout/PageShell";

const CONTACT_EMAIL = "selcuk.1@osu.edu";

export default function ContactPage() {
  return (
    <PageShell>
      <PageHeader
        className="page-header-prominent"
        title="Contact"
        description={
          <span className="text-[var(--text)]">
            For questions, feedback, or database-related requests, please contact us by email.
          </span>
        }
        actions={
          <a className="button button-secondary" href={`mailto:${CONTACT_EMAIL}`}>
            Email {CONTACT_EMAIL}
          </a>
        }
      />
    </PageShell>
  );
}
