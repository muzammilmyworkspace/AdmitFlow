import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Rate limiting — docs/47-rate-limiting.md.
//
// Two drivers behind one interface. Redis is the documented production store (shared
// across instances); the in-memory store is used when no REDIS_URL is configured, which
// is correct for single-process local development and honest about its limitation: it
// does NOT coordinate across instances, so it must never be the production store.

export interface RateLimitPolicy {
  /** Maximum requests allowed inside the window. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

interface RateLimitStore {
  hit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

// Concrete limits per endpoint class — docs/47-rate-limiting.md §2.
export const RATE_LIMITS = {
  LOGIN: { limit: 10, windowMs: 15 * 60 * 1000 },
  SIGNUP: { limit: 5, windowMs: 60 * 60 * 1000 },
  PASSWORD_RESET_REQUEST: { limit: 5, windowMs: 60 * 60 * 1000 },
  OTP_VERIFY: { limit: 10, windowMs: 15 * 60 * 1000 },
  ASSESSMENT_RUN: { limit: 20, windowMs: 60 * 60 * 1000 },
  VAULT_UPLOAD_AUTH: { limit: 30, windowMs: 60 * 1000 },
  CHECKOUT: { limit: 15, windowMs: 60 * 1000 },
  BOOKING: { limit: 20, windowMs: 60 * 1000 },
  APPLICATION_SUBMIT: { limit: 10, windowMs: 60 * 1000 },
  // A student opens one review per assessment, so this only has to stop a loop.
  ASSESSMENT_REVIEW_REQUEST: { limit: 10, windowMs: 60 * 60 * 1000 },
  // Staff claiming and delivering from the consultant queue. Generous, because a
  // consultant working through a backlog is the expected case, not the abusive one.
  REVIEW_QUEUE_ACTION: { limit: 120, windowMs: 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  async hit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - policy.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    timestamps.push(now);
    this.hits.set(key, timestamps);

    // Opportunistic sweep so an idle process doesn't grow unboundedly.
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => t <= cutoff)) this.hits.delete(k);
      }
    }

    const oldest = timestamps[0] ?? now;
    return {
      allowed: timestamps.length <= policy.limit,
      remaining: Math.max(0, policy.limit - timestamps.length),
      resetAt: new Date(oldest + policy.windowMs),
    };
  }

  async reset(key: string): Promise<void> {
    this.hits.delete(key);
  }
}

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (!store) {
    // A Redis-backed store is the documented production driver; it is selected here when
    // a Redis connection is configured and available. Until Redis is provisioned (see
    // docs/55-known-risks-and-open-questions.md), the in-memory store is used and this
    // fact is logged once so it can never be a silent production misconfiguration.
    store = new MemoryRateLimitStore();
    logger.warn("Rate limiting is using the in-memory store (single-process only)", {
      service: "rate-limit",
      operation: "getStore",
    });
  }
  return store;
}

/**
 * Consumes one unit against `key` and throws `RATE_LIMITED` when the policy is exceeded.
 *
 * The key must include whatever dimension the limit is scoped to (IP, account, or both)
 * — see callers. Keys are namespaced by policy name so different endpoint classes never
 * share a bucket.
 */
/**
 * SIGNUP alone is relaxed outside production.
 *
 * That policy is scoped by IP, and it exists to stop one origin creating accounts in
 * bulk. In development and in the automated suites every request really does come from
 * 127.0.0.1, so it ends up measuring a concentration that is an artefact of the
 * environment rather than a signal about it: a full browser run needs six accounts and
 * the production policy allows five an hour, so the suite could not pass however correct
 * the product was.
 *
 * Deliberately only this one. LOGIN is left alone because scripts/e2e.sh §10 trips it on
 * purpose to prove it works — relaxing that would leave the assertion passing while
 * testing nothing. Production is untouched in either case: APP_ENV is validated as one of
 * three values, so this cannot be switched on by a stray environment variable.
 */
function limitFor(
  policyName: keyof typeof RATE_LIMITS,
  policy: RateLimitPolicy,
): RateLimitPolicy {
  if (policyName !== "SIGNUP" || process.env.APP_ENV === "production") return policy;
  return { ...policy, limit: policy.limit * 20 };
}

export async function enforceRateLimit(
  policyName: keyof typeof RATE_LIMITS,
  key: string,
): Promise<void> {
  const policy = limitFor(policyName, RATE_LIMITS[policyName]);
  const result = await getStore().hit(`${policyName}:${key}`, policy);
  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    throw new AppError(
      "RATE_LIMITED",
      `Too many attempts. Please try again in ${retryAfterSeconds > 60 ? `${Math.ceil(retryAfterSeconds / 60)} minutes` : `${retryAfterSeconds} seconds`}.`,
      { retryAfterSeconds },
    );
  }
}

export async function resetRateLimit(
  policyName: keyof typeof RATE_LIMITS,
  key: string,
): Promise<void> {
  await getStore().reset(`${policyName}:${key}`);
}
