import type { Metadata } from "next";
import { UniversitySearch } from "@/features/universities/UniversitySearch";

export const metadata: Metadata = { title: "Universities · AdmitFlow" };

export default function UniversitiesPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Universities</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Browse the full catalog. Programmes flagged “data may be outdated” haven&apos;t been
        re-verified recently — check the university&apos;s own site before relying on them.
      </p>
      <UniversitySearch />
    </div>
  );
}
