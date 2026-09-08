import type { Metadata } from "next";
import { University } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { UniversitySearch } from "@/features/universities/UniversitySearch";

export const metadata: Metadata = { title: "Universities · AdmitFlow" };

export default function UniversitiesPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        icon={University}
        eyebrow="Explore"
        title="Universities"
        description={
          <>
            Browse the full catalog. Programmes flagged “data may be outdated” haven&apos;t been
            re-verified recently — check the university&apos;s own site before relying on them.
          </>
        }
      />
      <UniversitySearch />
    </div>
  );
}
