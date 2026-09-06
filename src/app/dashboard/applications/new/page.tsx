import { Suspense } from "react";
import type { Metadata } from "next";
import { NewApplicationView } from "@/features/applications/NewApplicationView";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Start an application · AdmitFlow" };

export default function NewApplicationPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <NewApplicationView />
    </Suspense>
  );
}
