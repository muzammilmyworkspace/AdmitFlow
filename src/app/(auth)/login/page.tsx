import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/LoginForm";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  // One-click test sign-in while the auth module is being finished; hidden in production.
  return <LoginForm quickLogin={getEnv().APP_ENV !== "production"} />;
}
