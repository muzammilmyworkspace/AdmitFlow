import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsultationView } from "@/features/consultation/ConsultationView";

export const metadata: Metadata = { title: "Consultation · AdmitFlow" };

export default function ConsultationPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        icon={CalendarDays}
        eyebrow="When you need a person"
        title="Book a consultation"
        description={
          <>
            Most of this platform exists so you don&apos;t need a consultant. When a real question
            needs a human, book one — 40 minutes, €30, no package, no retainer.
          </>
        }
      />
      <ConsultationView />
    </div>
  );
}
