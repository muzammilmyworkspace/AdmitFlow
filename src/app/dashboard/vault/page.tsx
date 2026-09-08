import type { Metadata } from "next";
import { FolderLock } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { VaultView } from "@/features/vault/VaultView";

export const metadata: Metadata = { title: "Document vault" };

export default function VaultPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        icon={FolderLock}
        eyebrow="Your files"
        title="Document vault"
        description={
          <>
            Your documents are stored privately. Nobody can reach them without a short-lived link
            issued to you specifically.
          </>
        }
      />
      <VaultView />
    </div>
  );
}
