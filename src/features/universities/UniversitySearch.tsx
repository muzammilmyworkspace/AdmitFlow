"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FormField } from "@/components/ui/FormField";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiGet, ApiError } from "@/lib/api-client";

interface ProgramRow {
  id: string;
  name: string;
  level: string;
  fieldOfStudy: string;
  durationMonths: number;
  university: { name: string; country: string; worldRanking: number | null };
  city: string | null;
  tuition: { amount: number; currency: string } | null;
  minIelts: number | null;
  minGpa: number | null;
  nextIntake: { term: string; status: string; applicationDeadline: string } | null;
  dataFreshness: { isStale: boolean; source: string | null };
}

interface Country {
  id: string;
  name: string;
}

export function UniversitySearch() {
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaging, setIsPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ q: "", countryId: "", level: "", maxIelts: "" });

  const search = useCallback(
    async (nextCursor?: string) => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.countryId) params.set("countryId", filters.countryId);
      if (filters.level) params.set("level", filters.level);
      if (filters.maxIelts) params.set("maxIelts", filters.maxIelts);
      if (nextCursor) params.set("cursor", nextCursor);

      const response = await fetch(`/api/v1/programs?${params.toString()}`);
      const payload = await response.json();
      if (!payload.success) throw new ApiError(payload.error);

      setPrograms((prev) =>
        nextCursor ? [...prev, ...payload.data.programs] : payload.data.programs,
      );
      setCursor(payload.meta.pagination.nextCursor);
      setHasMore(payload.meta.pagination.hasMore);
    },
    [filters],
  );

  useEffect(() => {
    apiGet<{ countries: Country[] }>("/api/v1/reference/countries")
      .then((r) => setCountries(r.countries))
      .catch(() => setCountries([]));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    search()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Search failed."))
      .finally(() => setIsLoading(false));
  }, [search]);

  async function loadMore() {
    if (!cursor || isPaging) return;
    setIsPaging(true);
    try {
      await search(cursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more results.");
    } finally {
      setIsPaging(false);
    }
  }

  return (
    <div>
      <Card className="mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setIsLoading(true);
            search().finally(() => setIsLoading(false));
          }}
        >
          <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Search">
              <Input
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Programme, field or university"
              />
            </FormField>
            <FormField label="Country">
              <Select
                value={filters.countryId}
                onChange={(e) => setFilters({ ...filters, countryId: e.target.value })}
              >
                <option value="">Any country</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Level">
              <Select
                value={filters.level}
                onChange={(e) => setFilters({ ...filters, level: e.target.value })}
              >
                <option value="">Any level</option>
                <option value="BACHELORS">Bachelor&apos;s</option>
                <option value="MASTERS">Master&apos;s</option>
                <option value="DOCTORATE">Doctorate</option>
                <option value="DIPLOMA">Diploma</option>
                <option value="CERTIFICATE">Certificate</option>
              </Select>
            </FormField>
            <FormField label="Max IELTS required">
              <Input
                type="number"
                step="0.5"
                min="0"
                max="9"
                value={filters.maxIelts}
                onChange={(e) => setFilters({ ...filters, maxIelts: e.target.value })}
                placeholder="e.g. 6.5"
              />
            </FormField>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Card>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : programs.length === 0 ? (
        <EmptyState
          title="No programmes matched"
          description="Try widening your filters — fewer constraints usually surfaces options worth considering."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {programs.map((program) => (
              <li key={program.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-text-primary">{program.name}</h3>
                      <p className="text-sm text-text-secondary">
                        {program.university.name} ·{" "}
                        {program.city ? `${program.city}, ` : ""}
                        {program.university.country}
                        {program.university.worldRanking
                          ? ` · #${program.university.worldRanking}`
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone="neutral">{program.level}</Badge>
                        {program.minIelts !== null && (
                          <Badge tone="info">IELTS {program.minIelts}</Badge>
                        )}
                        {program.minGpa !== null && (
                          <Badge tone="info">GPA {program.minGpa}</Badge>
                        )}
                        {program.dataFreshness.isStale && (
                          <Badge tone="warning">Data may be outdated</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {program.tuition && (
                        <p className="font-medium text-text-primary">
                          {program.tuition.amount.toLocaleString()} {program.tuition.currency}
                          <span className="block text-xs font-normal text-text-secondary">
                            per year
                          </span>
                        </p>
                      )}
                      {program.nextIntake && (
                        <p className="mt-1 text-xs text-text-secondary">
                          {program.nextIntake.term}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-text-secondary/15 pt-3">
                    <Link href={`/dashboard/universities/${program.id}`}>
                      <Button variant="ghost" size="sm">
                        Details
                      </Button>
                    </Link>
                    <Link href={`/dashboard/applications/new?programId=${program.id}`}>
                      <Button size="sm">Apply</Button>
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="mt-4 text-center">
              <Button variant="ghost" onClick={loadMore} isLoading={isPaging}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
