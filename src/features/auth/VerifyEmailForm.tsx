"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiPost, ApiError } from "@/lib/api-client";

export function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const userId = searchParams.get("userId");

  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifyingLink, setIsVerifyingLink] = useState(!!token);
  // Guards against React 18 StrictMode double-invoking the effect in development and
  // burning the single-use token on the first (discarded) render pass.
  const linkAttempted = useRef(false);

  const verify = useCallback(
    async (payload: Record<string, string>) => {
      await apiPost("/api/v1/auth/verify-email", payload);
      router.push("/dashboard");
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (!token || linkAttempted.current) return;
    linkAttempted.current = true;
    verify({ token }).catch((err) => {
      setError(err instanceof ApiError ? err.message : "Verification failed. Please try again.");
      setIsVerifyingLink(false);
    });
  }, [token, verify]);

  async function handleOtpSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || !userId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await verify({ userId, otp });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed. Please try again.");
      setIsSubmitting(false);
    }
  }

  if (isVerifyingLink) {
    return (
      <Card className="flex items-center gap-3 shadow-lg">
        <Spinner className="text-secondary-600" />
        <span className="text-sm text-text-secondary">Verifying your email…</span>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
        <MailCheck className="h-6 w-6 text-secondary-700" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
        Check your inbox
      </h1>
      <p className="mb-6 mt-1.5 text-sm leading-relaxed text-text-secondary">
        We sent you a verification link and a 6-digit code. Either one works — whichever is
        easier.
      </p>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {userId ? (
        <form onSubmit={handleOtpSubmit} noValidate>
          <FormField label="6-digit code" hint="Expires 10 minutes after it was sent.">
            <Input
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              placeholder="000000"
              // Wide tracking and a centred monospace-ish rhythm make a 6-digit code far
              // easier to check against the one in the email than default body text.
              className="text-center text-xl font-semibold tracking-[0.45em] tabular-nums"
            />
          </FormField>
          <Button type="submit" className="w-full" isLoading={isSubmitting} disabled={otp.length !== 6}>
            Verify email
          </Button>
        </form>
      ) : (
        <Alert tone="info">
          Open the verification link from your email to continue. If it has expired, sign in
          again to request a new one.
        </Alert>
      )}
    </Card>
  );
}
