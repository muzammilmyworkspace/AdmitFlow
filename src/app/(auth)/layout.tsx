import Link from "next/link";

// Shared shell for the auth screens — keeps the branded frame in one place rather than
// repeating it per page (docs/100 of the build brief: "do not create every page
// independently").
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-12">
      <Link href="/" className="mb-8 text-2xl font-semibold text-primary">
        AdmitFlow
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 max-w-md text-center text-xs text-text-secondary">
        AdmitFlow provides eligibility guidance only. It is not an admission or visa
        decision — those rest with universities and immigration authorities.
      </p>
    </main>
  );
}
