"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/StatusScreen";

// Route-level error boundary. Next requires this to be a client component.
//
// The digest is the only thing shown from the error itself: `error.message` on a server
// exception can carry a query, a path, or a value from someone's profile, and this page
// is rendered in a browser. The digest is a hash the server logged alongside the real
// stack, so support can find the exact failure without any of it being printed here.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Structured server logging already captured this; this is the browser-side record
    // for whoever is looking at a session replay or a console.
    console.error("Unhandled application error", error.digest ?? error.message);
  }, [error]);

  return (
    <StatusScreen
      icon={AlertTriangle}
      eyebrow="Something went wrong"
      title="That didn't work"
      description={
        <>
          <p>
            Something failed on our side, not yours. Nothing you had saved has been lost —
            try again, and if it keeps happening, send us the reference below.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-xs text-text-muted">Reference: {error.digest}</p>
          )}
        </>
      }
    >
      <Button onClick={reset}>Try again</Button>
      <Link href="/dashboard">
        <Button variant="ghost">Back to your dashboard</Button>
      </Link>
    </StatusScreen>
  );
}
