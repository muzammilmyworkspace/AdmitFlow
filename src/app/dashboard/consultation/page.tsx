import type { Metadata } from "next";
import { ConsultationView } from "@/features/consultation/ConsultationView";

export const metadata: Metadata = { title: "Consultation · AdmitFlow" };

export default function ConsultationPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Book a consultation</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Most of this platform exists so you don&apos;t need a consultant. When a real question
        needs a human, book one — 40 minutes, €30, no package, no retainer.
      </p>
      <ConsultationView />
    </div>
  );
}
