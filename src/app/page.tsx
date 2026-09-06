export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-semibold text-primary">AdmitFlow</h1>
      <p className="max-w-md text-text-secondary">
        Say No to Consultants. Apply Abroad Yourself. Foundation phase in progress — see{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-sm shadow-sm">
          docs/52-implementation-roadmap.md
        </code>
        .
      </p>
    </main>
  );
}
