import type { PrismaClient } from "./generated/client";

// Development/staging test accounts — docs/50-test-accounts.md.
//
// These exist so every role can be exercised without hand-crafting rows. They are gated
// on APP_ENV and refuse to run in production: seeded credentials in a production database
// are a backdoor, not a convenience.

const DEV_PASSWORD = "AdmitFlowDev42!";

/**
 * `src/lib/auth/password.ts` opens with `import "server-only"`, whose export condition
 * throws outside a React Server Component — so a plain import here crashes `tsx`.
 * Stubbing the marker and importing the real helper is deliberately preferred over
 * re-implementing argon2id: a second implementation could drift from the app's
 * parameters and mint hashes the login path cannot verify.
 */
async function loadHashPassword() {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  try {
    require.resolve("server-only");
    require.cache[require.resolve("server-only")] = {
      id: "server-only",
      filename: "server-only",
      loaded: true,
      exports: {},
    } as NodeJS.Module;
  } catch {
    // Not installed in this context — nothing to stub.
  }
  const mod = await import("../src/lib/auth/password");
  return mod.hashPassword;
}

const ACCOUNTS = [
  {
    email: "admin@admitflow.example",
    firstName: "Ada",
    lastName: "Admin",
    role: "ADMIN",
    status: "ACTIVE" as const,
  },
  {
    email: "superadmin@admitflow.example",
    firstName: "Sam",
    lastName: "Super",
    role: "SUPER_ADMIN",
    status: "ACTIVE" as const,
  },
  {
    email: "student@admitflow.example",
    firstName: "Sana",
    lastName: "Student",
    role: "STUDENT",
    status: "ONBOARDING" as const,
  },
];

export async function seedTestAccounts(db: PrismaClient): Promise<void> {
  if (process.env.APP_ENV === "production") {
    console.warn("Refusing to seed test accounts in production.");
    return;
  }

  const hashPassword = await loadHashPassword();
  const passwordHash = await hashPassword(DEV_PASSWORD);

  for (const account of ACCOUNTS) {
    const existing = await db.user.findUnique({ where: { email: account.email } });
    if (existing) continue;

    const role = await db.role.findUnique({ where: { name: account.role } });
    if (!role) throw new Error(`Role ${account.role} is missing — seed roles first.`);

    await db.user.create({
      data: {
        email: account.email,
        passwordHash,
        status: account.status,
        emailVerifiedAt: new Date(),
        profile: { create: { firstName: account.firstName, lastName: account.lastName } },
        userRoles: { create: { roleId: role.id } },
      },
    });
  }

  console.log(
    `Test accounts ready (password: ${DEV_PASSWORD}): ${ACCOUNTS.map((a) => a.email).join(", ")}`,
  );
}
