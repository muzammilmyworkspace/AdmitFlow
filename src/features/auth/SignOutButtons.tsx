"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiPost } from "@/lib/api-client";

export function SignOutButtons() {
  const router = useRouter();
  const [pending, setPending] = useState<"one" | "all" | null>(null);

  async function signOut(path: string, which: "one" | "all") {
    if (pending) return;
    setPending(which);
    try {
      await apiPost(path, {});
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="ghost"
        size="sm"
        isLoading={pending === "one"}
        onClick={() => signOut("/api/v1/auth/logout", "one")}
      >
        Sign out
      </Button>
      <Button
        variant="ghost"
        size="sm"
        isLoading={pending === "all"}
        onClick={() => signOut("/api/v1/auth/logout-all", "all")}
      >
        Sign out everywhere
      </Button>
    </div>
  );
}
