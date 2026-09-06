import type { Metadata } from "next";
import { SignupForm } from "@/features/auth/SignupForm";

export const metadata: Metadata = { title: "Create your account · AdmitFlow" };

export default function SignupPage() {
  return <SignupForm />;
}
