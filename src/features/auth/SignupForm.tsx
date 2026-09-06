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
import { PASSWORD_REQUIREMENTS } from "@/lib/auth/password-policy";

export function SignupForm() {
  const router = useRouter();
  const [values, setValues] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update(field: keyof typeof values) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Guard against double-submit from a fast second click; the server is idempotent on
    // email uniqueness regardless, this just keeps the UI honest.
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<{ userId: string }>("/api/v1/auth/signup", values);
      router.push(`/verify-email?userId=${result.userId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold text-text-primary">Create your account</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Start your free eligibility assessment. No consultant required.
      </p>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <FormField label="First name">
            <Input value={values.firstName} onChange={update("firstName")} required autoComplete="given-name" />
          </FormField>
          <FormField label="Last name">
            <Input value={values.lastName} onChange={update("lastName")} required autoComplete="family-name" />
          </FormField>
        </div>

        <FormField label="Email">
          <Input type="email" value={values.email} onChange={update("email")} required autoComplete="email" />
        </FormField>

        {/* Password requirements are shown before submission, never discovered only
            after a rejected attempt (docs/30-validation-rules.md §2). */}
        <FormField label="Password" hint={PASSWORD_REQUIREMENTS.join(" · ")}>
          <Input
            type="password"
            value={values.password}
            onChange={update("password")}
            required
            autoComplete="new-password"
          />
        </FormField>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
