"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { apiPost } from "@/lib/api-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await apiPost("/api/v1/auth/forgot-password", { email });
    } finally {
      // The response is deliberately identical whether or not the account exists, so the
      // UI must not branch on it either — anything else would reintroduce the
      // enumeration leak the endpoint exists to prevent.
      setSent(true);
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold text-text-primary">Reset your password</h1>
      <p className="mb-6 text-sm text-text-secondary">
        We&apos;ll email you a link to set a new password.
      </p>

      {sent ? (
        <Alert tone="success">
          If an account exists for that email, a reset link has been sent. The link expires in
          30 minutes.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </FormField>
          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-text-secondary">
        <Link href="/login" className="font-medium text-primary underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
