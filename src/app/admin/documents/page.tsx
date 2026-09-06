import type { Metadata } from "next";
import { DocumentQueue } from "@/features/admin/DocumentQueue";

export const metadata: Metadata = { title: "Document queue · Admin" };

export default function AdminDocumentsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Document review queue</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Every decision here is recorded against your account, and the student is notified
        either way.
      </p>
      <DocumentQueue />
    </div>
  );
}
