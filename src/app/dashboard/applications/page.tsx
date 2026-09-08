import type { Metadata } from "next";
import { Send } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApplicationsView } from "@/features/applications/ApplicationsView";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        icon={Send}
        eyebrow="Your applications"
        title="Applications"
        description={
          <>
            Nothing is sent until you submit it, and we&apos;ll tell you exactly what&apos;s
            outstanding before you can.
          </>
        }
      />
      <ApplicationsView />
    </div>
  );
}
