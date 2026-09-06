import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in · AdmitFlow" };

export default function LoginPage() {
  return <LoginForm />;
}
