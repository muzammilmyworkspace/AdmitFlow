import type { Metadata } from "next";
import { ApplicationsView } from "@/features/applications/ApplicationsView";

export const metadata: Metadata = { title: "Applications · AdmitFlow" };

export default function ApplicationsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Applications</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Nothing is sent until you submit it, and we&apos;ll tell you exactly what&apos;s
        outstanding before you can.
      </p>
      <ApplicationsView />
    </div>
  );
}
