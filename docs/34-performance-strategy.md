# 34 — Performance Strategy

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Frontend rendering, API design, and database access patterns

---

## 1. Purpose

Performance targets are stated in `00-project-charter.md` §6 (LCP P75 < 2.5s on mobile) and §10 (scale to 10,000+ students without re-architecture). This document sets the concrete engineering conventions that make those targets achievable and keep them true as data volume grows, not just at launch with a near-empty database.

## 2. Initial Load Performance

- **SSR/streaming:** pages that need data before they're meaningful (dashboard, assessment results, application list) are server-rendered; where a page has both fast "shell" content and slower per-request data, React Server Components streaming is used so the shell paints immediately and slower sections stream in, rather than blocking the whole route on the slowest query.
- **Minimal JS:** Client Components are opt-in, not default — a component ships to the client only if it needs interactivity/state; static/presentational sections stay server-rendered with zero client JS cost. Bundle size is checked in CI (see `40-ci-cd.md`) against a budget per route group.
- **Optimized images:** all product imagery (university logos, marketing assets) served through Next.js image optimization (responsive `srcset`, modern formats, lazy-loaded below the fold) and via the CDN/edge layer, not served unoptimized from S3 directly. (Private student documents are never served as inline images at all — they only ever leave S3 via a signed download URL the user explicitly requests, per `06-system-architecture.md`.)
- **Font loading:** Inter self-hosted/optimized via `next/font` (no render-blocking third-party font request) to avoid layout shift and an extra DNS/TLS round trip on first paint.

## 3. Pagination — Mandatory, Cursor-Based

**Decision:** every endpoint that returns a collection (`universities`, `programs`, `applications`, `documents`, `users`, `payments`, `audit logs`, `notifications`, `bookings`) is paginated. There is no "return all" mode on any list endpoint, including for admin/internal use — an admin needing "all" audit log entries for a report gets there by paging through with a script, not by the API offering an unbounded response. Rationale: an unbounded list endpoint is a correctness landmine at 100 rows and an outage at 10,000+ students' worth of applications/documents/audit entries.

- **Mechanism:** cursor-based pagination (opaque cursor encoding the last-seen sort key + id, not raw offset), because offset pagination degrades (`OFFSET N` gets slower as N grows) and is unstable under concurrent writes (rows shifting between pages) — both of which matter for admin views like audit logs and payments that are written to continuously.
- **Max page size:** every paginated endpoint enforces a hard server-side maximum page size (default `limit=20`, max `100` per `11-api-architecture.md` §7; admin/reporting endpoints follow the same cap) regardless of what the client requests — a client-supplied `limit` above the max is clamped, never honored as-is.
- **Response envelope:** the canonical `{success, data, meta: {requestId, pagination: {nextCursor, hasMore, pageSize}}}` shape defined in `11-api-architecture.md` §5/§7 is used by every list endpoint without exception — this document does not define a competing envelope; it only adds the performance rationale (cursor over offset, indexed cursor columns) behind that shape.

The frontend consumes this envelope through the shared `Paginated<T>` type in `schemas/pagination.ts` (per `07-frontend-architecture.md` §4), which mirrors the backend contract rather than inventing its own shape.

## 4. Search: University/Program Catalog

**Decision:** university/program search is built on indexed, structured filters — country, city, university, program name, degree level, tuition range, intake term, English-proficiency requirement, and ranking band are all backed by database indexes (B-tree for equality/range filters such as country/degree/tuition/ranking; see §5) and combined via a query builder that constructs a single indexed Prisma/SQL query, not a client-side or application-level filter over a full table scan.

**Explicitly ruled out:** an unconstrained `WHERE column LIKE '%query%'` scan repeated across every searchable column (name, city, country, description, etc.) is not an acceptable implementation for free-text search at scale — a leading-wildcard `LIKE` cannot use a standard B-tree index and degrades to a full table scan per query, which does not hold up once the catalog is at the thousands-of-programs scale AdmitFlow is designed to reach.

**What to use instead for the free-text portion** (searching "Toronto" or "computer science" across name/description fields):

- **Recommended:** PostgreSQL's trigram extension (`pg_trgm`) with a GIN index on the searchable text column(s), enabling fast fuzzy/substring matching that *does* use an index; or PostgreSQL full-text search (`tsvector`/`tsquery` with a GIN index) if relevance ranking across multiple fields matters more than fuzzy substring matching.
- Structured filters (country, degree, tuition range, intake, ranking) are always applied as indexed `WHERE` clauses first (they're typically the highest-selectivity, cheapest to evaluate), with the trigram/full-text condition applied as an additional indexed predicate — not as a post-filter over an already-large result set.
- Search results are paginated per §3 — search never returns an unbounded match set even when a query is broad.

## 5. Database Query Optimization Conventions

- **Indexes required on:** every foreign key, every column used in a `WHERE`/`ORDER BY` on a paginated or search endpoint (country, city, degree level, tuition, intake, ranking, `createdAt` for cursor pagination, `userId` on every per-user table), and the trigram/full-text index described in §4.
- **No N+1 queries:** Prisma `include`/`select` is used to fetch exactly the related data a response needs in one query (or a small fixed number of queries), never a list query followed by a per-row query in application code. This is enforced by code review convention and, where feasible, a query-count assertion in integration tests for list endpoints (fetching N rows should not scale the query count with N).
- **Select only needed columns:** endpoints use Prisma `select` to avoid pulling large/irrelevant columns (e.g. a university list endpoint does not pull long-form description fields it won't render; a document list endpoint never pulls binary content — see below).
- **Never load document binaries into application memory:** document bytes live in S3, not in Postgres, and are never read into a Next.js route handler or worker process's memory to be re-served — access is always via a signed URL generated from S3 metadata (bucket/key), so "downloading a document" means the browser talks to S3 directly using a short-lived signed URL, not the app streaming bytes through itself. The one exception is the worker's malware-scanning/verification pipeline, which necessarily reads file bytes, but does so as a bounded streaming operation in the long-running worker process — never in a serverless route handler (`06-system-architecture.md` §5) — and never persists the full bytes anywhere outside S3.
- **Aggregate/count queries:** list endpoints that show a total count (e.g. "1,204 programs match") use a separate, indexed count query rather than fetching all matching rows to count them client-side; where an exact count is expensive at scale, an approximate/capped count (e.g. "200+ results") is an acceptable degradation.

## 6. Performance Budgets (illustrative, revisit post-launch per charter §6)

| Path | Budget |
|---|---|
| Core page LCP (P75, mobile) | < 2.5s (per charter) |
| `/api/v1/universities` search (indexed filters, paginated) | < 300ms P95 at 10,000+ catalog rows |
| `/api/v1/assessment` scoring run | < 2s P95 (synchronous; if this ever grows to exceed a few seconds as rules get more complex, it moves to a queued job per `06-system-architecture.md` §5's rule of thumb) |
| Document signed-URL issuance | < 200ms P95 (metadata lookup + S3 signing only, no file I/O) |
| Paginated list endpoints (applications, documents, audit logs, payments) | < 300ms P95 at max page size |

These budgets are enforced informally at launch (manual review, staging load tests) and should graduate to automated performance regression checks in CI as the platform matures — see `40-ci-cd.md` for where that would slot into the pipeline.
