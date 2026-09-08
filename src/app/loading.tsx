import { Spinner } from "@/components/ui/Spinner";
import { AmbientBackground } from "@/components/brand/AmbientBackground";

// Shown while a server component streams. Deliberately quiet — a full skeleton of a page
// we cannot yet describe would only guess at the layout and flash into something else.
export default function Loading() {
  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <AmbientBackground />
      <p className="flex items-center gap-3 text-sm text-text-secondary" role="status">
        <Spinner />
        Loading…
      </p>
    </div>
  );
}
