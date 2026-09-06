# 44 — SEO Strategy

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering / Marketing
**Depends on:** `07-frontend-architecture.md` (Next.js App Router conventions)
**Read alongside:** `34-performance-strategy.md` (Core Web Vitals budgets, not duplicated here), `00-project-charter.md` (no-dark-patterns product principle this document enforces for marketing surfaces)

---

## 1. Purpose and Scope

This document defines how AdmitFlow's **public, unauthenticated marketing pages** are made crawlable, indexable, and honestly represented in search results. It covers: `/`, `/pricing`, `/about`, `/how-it-works`, `/universities`, `/guides`, `/faq`. It does not cover the authenticated student/consultant/admin application (which is intentionally not indexed — §6) and does not re-derive performance budgets already owned by `34-performance-strategy.md`; it references them only where SEO and performance intersect (§5).

## 2. Rendering Strategy: SSR/SSG for Every Public Page

**Decision:** every page in scope is rendered via Next.js App Router **static generation (SSG) with incremental revalidation** where content changes infrequently (`/about`, `/how-it-works`, `/pricing`, `/faq` — sourced from the CMS content described in `25-admin-platform.md` §10) or **server-side rendering (SSR)** where content is derived from live, admin-managed data that changes more often (`/universities`, and per-university detail pages) — never client-side-only rendering for anything a search crawler needs to index. Rationale: a crawler-dependent client-rendered page is a well-known SEO liability (indexing delay, inconsistent rendering across crawlers) that has no upside here, since none of these pages require per-visitor personalization.

| Page | Rendering mode | Revalidation trigger |
|---|---|---|
| `/` (home) | SSG + ISR | On-demand revalidation when marketing content is published (`25-admin-platform.md` §10) |
| `/pricing` | SSG + ISR | On-demand revalidation when `Product`/`Price` records change |
| `/about` | SSG + ISR | On-demand revalidation on content publish |
| `/how-it-works` | SSG + ISR | On-demand revalidation on content publish |
| `/universities` (list) + `/universities/[slug]` (detail) | SSR (or SSG with a scheduled revalidation window, e.g. hourly) | University/program data is admin-managed (`25-admin-platform.md` §5) but changes more often than static marketing copy; SSR keeps listings from serving stale requirement/deadline data, which would be actively misleading rather than just outdated marketing copy |
| `/guides` (index) + `/guides/[slug]` | SSG + ISR | On-demand revalidation on content publish |
| `/faq` | SSG + ISR | On-demand revalidation on content publish |

On-demand revalidation is triggered directly by the relevant admin-console publish action (content publish, pricing change, university data publish) calling Next.js's on-demand revalidation API — not a blind time-based cache expiry — so a published change is reflected immediately rather than waiting out a stale window, while still getting the caching benefit of SSG between publishes.

## 3. Metadata, Open Graph, and Canonical URLs

Every page in scope defines, via the App Router's `generateMetadata` convention:

- **`<title>`** — unique per page, following a fixed pattern (`{Page-specific title} | AdmitFlow by SNZ Ventures`), never a duplicated/generic title across pages (a top, easily-avoided SEO defect).
- **`<meta name="description">`** — unique, human-written (or content-team-authored, never auto-truncated body text as a lazy default) per page, ~150–160 characters.
- **Open Graph tags** (`og:title`, `og:description`, `og:image`, `og:type`, `og:url`) and matching Twitter Card tags — `og:image` is a real, purpose-built social preview asset per page type (a generic brand image for marketing pages, and for `/universities/[slug]` a templated image incorporating the university's real name/logo where licensing permits, never a placeholder stock image presented as if specific to that page).
- **Canonical URL** (`<link rel="canonical">`) on every page, including paginated/filtered variants of `/universities` and `/guides` (e.g. `?page=2`, `?country=uk`) pointing at the canonical unfiltered or page-1 form where appropriate, to prevent duplicate-content dilution across filter/sort permutations of the same underlying list.
- **`hreflang`** is out of scope for v1 (single-locale launch per `00-project-charter.md`'s stated scope) but the metadata structure is written so adding locale variants later is additive, not a rework.

## 4. Structured Data (Schema.org)

Structured data is added only where it accurately describes real content — never speculatively added to pages where it wouldn't be genuinely useful, since low-quality or inaccurate structured data risks a manual action from search engines, not just a missed opportunity.

| Page | Schema type | Notes |
|---|---|---|
| `/` (home) | `Organization` | Legal name, logo, `sameAs` links to real, active social profiles only (never a link to an unused/placeholder social account). |
| `/faq` | `FAQPage` | One `Question`/`acceptedAnswer` pair per real FAQ entry sourced from the Content module (`25-admin-platform.md` §10) — generated from the same data the visible page renders, never a separately hand-maintained duplicate that can drift out of sync with what's actually on the page. |
| `/guides/[slug]` | `Article` | Author (where a guide has a named author), `datePublished`, `dateModified` sourced from the content record's real publish/edit timestamps — never a fabricated or manually-backdated date. |
| `/universities/[slug]` | `CollegeOrUniversity` (where applicable fields exist) | Populated only from fields the Universities module (`25-admin-platform.md` §5) actually holds; a field with no real data is omitted from the structured data rather than filled with a placeholder. |
| `/pricing` | `Product`/`Offer` per plan | Price and currency sourced directly from the live `Product`/`Price` records used to actually charge users (`09-database-architecture.md` §4) — the structured data and the checkout flow read from the same source of truth, so they cannot silently disagree. |

## 5. Sitemap, Robots, and Crawl Control

- **`sitemap.xml`** is generated programmatically (Next.js `sitemap.ts` convention), enumerating every public marketing page plus every published `/universities/[slug]` and `/guides/[slug]` entry, each with a `lastmod` timestamp sourced from the underlying content/university record's real `updatedAt` — regenerated (or served dynamically) whenever content changes, not hand-maintained.
- **`robots.txt`** allows crawling of all pages in scope and explicitly disallows the entire authenticated application surface (`/app/*`, `/admin/*`, `/api/*`, or whatever path prefixes those resolve to per `06-system-architecture.md`) — both because those pages provide no SEO value and because listing them in a crawlable sitemap would be an unnecessary information-disclosure surface (revealing internal route structure to any visitor of `robots.txt`, not a security control on its own, but a needless disclosure to avoid).
- `sitemap.xml` is referenced from `robots.txt` and submitted to search-console tooling as part of launch, not left to organic discovery alone.

## 6. What Is Explicitly Not Indexed

The authenticated application (student dashboard, consultant portal, admin console) is excluded from indexing via both `robots.txt` disallow rules **and** a `noindex` meta tag / `X-Robots-Tag` header on those routes as a defense-in-depth measure (in case a crawler ignores `robots.txt`, or an authenticated page is ever accidentally linked from a public page). This is not primarily an SEO decision — it's a restatement, in SEO terms, of the object-level isolation principle in `02-personas-and-roles.md` §7: nothing behind auth should be discoverable via search regardless of who might click through.

## 7. Performance as an SEO Factor

Core Web Vitals (LCP, INP, CLS) are a direct ranking factor for the pages in scope, and the SSG/SSR strategy in §2 is chosen partly for this reason (static/server-rendered HTML avoids the largest common cause of poor LCP — client-side data-fetch-then-render waterfalls on the initial view). The concrete performance budgets, image-optimization strategy, and measurement/monitoring approach for these metrics are owned by `34-performance-strategy.md` and are not restated here; this document's obligation is only to ensure the rendering strategy chosen for SEO reasons doesn't conflict with the performance budgets set there (it doesn't — SSG/SSR is the performance-optimal choice for these specific pages as well).

## 8. No Fabricated Statistics or Fake Social Proof

**Rule (binding, ties to `00-project-charter.md`'s no-dark-patterns principle):** no marketing page may display a statistic, counter, testimonial, or "social proof" element that is not backed by real, currently-accurate data from the system. Concretely:

- A claim like "X,000+ students matched" or "Y successful applications" is either wired to a real, computed value (queried from live data, cached/revalidated like any other page content, per §2) or not shown at all — never a hardcoded placeholder number left in from early design mockups, and never a number quietly inflated "to look more credible."
- Testimonials/case studies use real, consented submissions (attributed with the real submitter's permission, or anonymized if that's the agreed form) — never AI-generated or composited "representative" quotes presented as if from real users.
- University logos/names shown as "supported" or "featured" universities reflect actual universities present in the live `University` catalog (`25-admin-platform.md` §5), not an aspirational or unlicensed list.
- If a real metric would currently be small or unflattering (e.g. early-stage user counts), the resolution is to **not display that specific metric yet** (choose a different, honest framing of the value proposition) rather than to fabricate or round up a number — this is treated as a product-integrity requirement enforced at the same level as the payment/refund honesty rules elsewhere in the platform, not a marketing-team style preference.
- **Decision:** any page component that renders a "stat" pulls its value through a typed data-fetching path backed by a real query (or a CMS field explicitly marked and reviewed as a sourced, dated claim, e.g. "per [source], [year]") — there is no generic "marketing stat" content-block type that accepts arbitrary free-text numbers with no backing query or citation, specifically to make it structurally harder to accidentally ship a fabricated figure.

## 9. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | SSG+ISR for stable marketing/content pages, SSR (or short-window SSG) for `/universities` | Crawlability and Core Web Vitals without serving stale requirement/deadline data as if current |
| D2 | On-demand revalidation triggered by the admin-console publish action, not blind time-based expiry | Published changes go live immediately while retaining SSG's caching benefit |
| D3 | Structured data added only where real underlying data exists (`FAQPage`, `Article`, `CollegeOrUniversity`, `Product`/`Offer`), generated from the same data the visible page renders | Prevents structured data from drifting out of sync with the page, and avoids the risk of low-quality/inaccurate markup |
| D4 | Authenticated app excluded from indexing via `robots.txt` disallow + `noindex`/`X-Robots-Tag` defense-in-depth | Restates object-level isolation principle in SEO terms |
| D5 | No content-block type accepts an arbitrary free-text "stat" with no backing query/citation | Structurally prevents fabricated statistics/fake social proof, not just a style guideline |

## 10. Related Documents

- `34-performance-strategy.md` — Core Web Vitals budgets and measurement (referenced, not duplicated, in §7)
- `07-frontend-architecture.md` — Next.js App Router conventions this document's rendering strategy builds on
- `25-admin-platform.md` §5, §10 — Universities and Content modules that supply the live data referenced throughout
- `00-project-charter.md` — no-dark-patterns principle this document enforces for marketing surfaces
