import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmailForm } from "@/features/auth/VerifyEmailForm";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    // useSearchParams needs a Suspense boundary to avoid opting the whole route into
    // client-side rendering at build time.
    <Suspense
      fallback={
        <Card className="flex items-center gap-3">
          <Spinner className="text-primary" />
          <span className="text-sm text-text-secondary">Loading…</span>
        </Card>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}
