import type { Metadata } from "next";
import { VaultView } from "@/features/vault/VaultView";

export const metadata: Metadata = { title: "Document vault · AdmitFlow" };

export default function VaultPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Document vault</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Your documents are stored privately. Nobody can reach them without a short-lived link
        issued to you specifically.
      </p>
      <VaultView />
    </div>
  );
}
