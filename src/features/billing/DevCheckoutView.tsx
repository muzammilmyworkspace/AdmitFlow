"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { apiPost, ApiError } from "@/lib/api-client";

export function DevCheckoutView() {
  const params = useSearchParams();
  const purchaseId = params.get("purchaseId") ?? "";
  const amount = params.get("amount") ?? "";
  const currency = params.get("currency") ?? "EUR";
  const product = params.get("product") ?? "";
  const successUrl = params.get("successUrl") ?? "/dashboard";
  const cancelUrl = params.get("cancelUrl") ?? "/dashboard";

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"pay" | "fail" | null>(null);

  async function complete(outcome: "SUCCEEDED" | "FAILED") {
    if (pending) return;
    setPending(outcome === "SUCCEEDED" ? "pay" : "fail");
    setError(null);
    try {
      await apiPost("/api/v1/billing/dev-complete", { purchaseId, outcome });
      window.location.href = outcome === "SUCCEEDED" ? successUrl : cancelUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete the payment.");
      setPending(null);
    }
  }

  return (
    <Card>
      <Alert tone="warning" className="mb-4">
        <strong>Development checkout.</strong> No real payment provider is configured, so this
        page stands in for one. It still goes through the real signed-webhook path — nothing
        is unlocked client-side.
      </Alert>

      <h1 className="mb-1 text-xl font-semibold text-text-primary">Confirm your payment</h1>
      <p className="mb-6 text-sm text-text-secondary">{product.replace(/_/g, " ")}</p>

      <div className="mb-6 rounded-md bg-bg px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Total</span>
          <span className="text-lg font-semibold text-text-primary">
            {amount} {currency}
          </span>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => complete("SUCCEEDED")} isLoading={pending === "pay"}>
          Pay {amount} {currency}
        </Button>
        <Button
          variant="ghost"
          onClick={() => complete("FAILED")}
          isLoading={pending === "fail"}
        >
          Simulate a failed payment
        </Button>
      </div>
    </Card>
  );
}
