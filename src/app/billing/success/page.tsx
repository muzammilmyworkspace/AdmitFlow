import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "Payment received" };

// Note what this page does NOT do: it does not grant anything, and it does not read a
// "paid=true" parameter. It is a landing page. Access is decided by entitlements the
// webhook wrote server-side, which the dashboard reads fresh (docs/54-decision-log.md D-5).
export default function BillingSuccessPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <Card>
        <h1 className="mb-2 text-xl font-semibold text-text-primary">Payment received</h1>
        <p className="mb-4 text-sm text-text-secondary">
          Thanks — your payment is being confirmed with the provider.
        </p>
        <Alert tone="info" className="mb-5">
          Access is granted once the provider confirms the payment to our servers, usually
          within a few seconds. If it isn&apos;t there yet, refresh in a moment.
        </Alert>
        <div className="flex gap-2">
          <Link href="/dashboard/assessment">
            <Button>View my matches</Button>
          </Link>
          <Link href="/dashboard/billing">
            <Button variant="ghost">Billing history</Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
