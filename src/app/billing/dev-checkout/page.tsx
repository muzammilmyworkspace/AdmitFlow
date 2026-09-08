import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEnv } from "@/lib/env";
import { DevCheckoutView } from "@/features/billing/DevCheckoutView";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Checkout" };

// Development stand-in for the payment provider's hosted checkout page.
//
// It does not grant anything. Pressing "pay" asks the server to sign and deliver a
// webhook to the real webhook endpoint, which verifies the signature and runs the same
// transactional grant that production uses — so the security-critical path is the one
// being exercised, not a shortcut around it.
export default function DevCheckoutPage() {
  if (getEnv().APP_ENV !== "development") notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <DevCheckoutView />
      </Suspense>
    </main>
  );
}
