import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/ResetPasswordForm";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = { title: "Choose a new password · AdmitFlow" };

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Card className="flex items-center gap-3">
          <Spinner className="text-primary" />
          <span className="text-sm text-text-secondary">Loading…</span>
        </Card>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
