"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { apiPost, ApiError } from "@/lib/api-client";
import { PASSWORD_REQUIREMENTS } from "@/lib/auth/password-policy";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || !token) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/v1/auth/reset-password", { token, newPassword });
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <Card>
        <Alert tone="error">
          This reset link is missing its token. Request a new one from the{" "}
          <Link href="/forgot-password" className="font-medium underline">
            forgot password
          </Link>{" "}
          page.
        </Alert>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold text-text-primary">Choose a new password</h1>
      <p className="mb-6 text-sm text-text-secondary">
        You&apos;ll be signed out everywhere once your password changes.
      </p>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {done ? (
        <Alert tone="success">Password updated. Redirecting you to sign in…</Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <FormField label="New password" hint={PASSWORD_REQUIREMENTS.join(" · ")}>
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </FormField>
          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </Card>
  );
}
