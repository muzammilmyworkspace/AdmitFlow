"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { apiPost, ApiError } from "@/lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [values, setValues] = useState({ email: "", password: "" });
  const [error, setError] = useState<{ message: string; unverified: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update(field: keyof typeof values) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/v1/auth/login", values);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const isApiError = err instanceof ApiError;
      setError({
        message: isApiError ? err.message : "Something went wrong. Please try again.",
        unverified: isApiError && err.code === "AUTH_EMAIL_NOT_VERIFIED",
      });
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold text-text-primary">Sign in</h1>
      <p className="mb-6 text-sm text-text-secondary">Welcome back to AdmitFlow.</p>

      {error && (
        <Alert tone="error" className="mb-4">
          {error.message}
          {error.unverified && (
            <>
              {" "}
              <Link href="/verify-email" className="font-medium underline">
                Verify your email
              </Link>
            </>
          )}
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <FormField label="Email">
          <Input type="email" value={values.email} onChange={update("email")} required autoComplete="email" />
        </FormField>
        <FormField label="Password">
          <Input
            type="password"
            value={values.password}
            onChange={update("password")}
            required
            autoComplete="current-password"
          />
        </FormField>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-center text-sm text-text-secondary">
        <Link href="/forgot-password" className="font-medium text-primary underline">
          Forgot your password?
        </Link>
        <span>
          New here?{" "}
          <Link href="/signup" className="font-medium text-primary underline">
            Create an account
          </Link>
        </span>
      </div>
    </Card>
  );
}
