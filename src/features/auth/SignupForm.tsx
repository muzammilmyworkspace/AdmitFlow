"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AtSign, Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { apiPost, ApiError } from "@/lib/api-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

/** Live requirement feedback, mirroring the server's policy exactly. */
function requirementState(password: string) {
  const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { label: "3 of: uppercase, lowercase, number, symbol", met: classes >= 3 },
  ];
}

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
    // Guards a fast second click; the server enforces email uniqueness regardless.
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

  const requirements = requirementState(values.password);

  return (
    <Card className="shadow-lg">
      <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
        Start your application
      </h1>
      <p className="mb-7 mt-1.5 text-sm text-text-secondary">
        Free to create, free to assess. No agent, no commission.
      </p>

      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <FormField label="First name">
            <Input
              value={values.firstName}
              onChange={update("firstName")}
              required
              autoComplete="given-name"
            />
          </FormField>
          <FormField label="Last name">
            <Input value={values.lastName} onChange={update("lastName")} required autoComplete="family-name" />
          </FormField>
        </div>

        <FormField label="Email">
          <Input
            type="email"
            value={values.email}
            onChange={update("email")}
            required
            autoComplete="email"
            icon={<AtSign />}
            placeholder="you@example.com"
          />
        </FormField>

        <FormField label="Password">
          <Input
            type="password"
            value={values.password}
            onChange={update("password")}
            required
            autoComplete="new-password"
            icon={<KeyRound />}
          />
        </FormField>

        {/* Requirements are shown up front and tick live, so the rule is never something
            the student discovers only after a rejected submit (docs/30 §2). */}
        <ul className="mb-6 -mt-1 space-y-1.5">
          {requirements.map((req) => (
            <li
              key={req.label}
              className={`flex items-center gap-2 text-xs transition-colors duration-fast ${
                req.met ? "text-secondary-600" : "text-text-muted"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-inset ${
                  req.met ? "bg-secondary-50 ring-secondary-300" : "ring-border"
                }`}
                aria-hidden
              >
                {req.met && <Check className="h-2.5 w-2.5" />}
              </span>
              {req.label}
            </li>
          ))}
        </ul>

        <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting}>
          Create my account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-secondary-700 underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
