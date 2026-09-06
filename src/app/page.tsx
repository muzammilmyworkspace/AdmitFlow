import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="mb-4 text-4xl font-semibold tracking-tight text-primary sm:text-5xl">
        Say No to Consultants.
        <span className="block text-secondary">Apply Abroad Yourself.</span>
      </h1>
      <p className="mb-8 max-w-xl text-text-secondary">
        Discover universities, understand your eligibility, organise your documents, and manage
        your application journey from one transparent platform.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/signup">
          <Button size="lg">Start free assessment</Button>
        </Link>
        <Link href="/login">
          <Button size="lg" variant="ghost">
            Sign in
          </Button>
        </Link>
      </div>

      <p className="mt-10 max-w-xl text-xs text-text-secondary">
        AdmitFlow gives you an indicative eligibility assessment based on the information you
        provide. It is not an admission or visa decision — those rest with universities and
        immigration authorities.
      </p>
    </main>
  );
}
