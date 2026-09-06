import type { Metadata } from "next";
import { ApplicationDetailView } from "@/features/applications/ApplicationDetailView";

export const metadata: Metadata = { title: "Application · AdmitFlow" };

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApplicationDetailView applicationId={id} />;
}
