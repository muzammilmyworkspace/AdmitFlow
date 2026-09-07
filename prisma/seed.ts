import { PrismaClient } from "./generated/client";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "../src/lib/rbac";
import { DEFAULT_RULES } from "../src/services/assessment/scoring";
import { seedCatalog } from "./seed-catalog";
import { seedConsultantAvailability } from "./seed-consultants";
import { seedTestAccounts } from "./seed-accounts";
import { seedNotificationTemplates } from "./seed-notifications";

// Deterministic, idempotent seed for reference/config data that ships to every
// environment including production (roles, permissions, products/prices) — see
// docs/37-seed-data-strategy.md and docs/51-seed-and-migration-plan.md's distinction
// between reference-data migrations and fake demo-data seeds. Demo accounts/catalog
// data are intentionally NOT included here yet (tracked in docs/55 I-6) — this file
// currently seeds only the reference data every environment needs to boot safely.

const db = new PrismaClient();

async function seedPermissions() {
  for (const key of Object.values(PERMISSIONS)) {
    await db.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: key.replace(/[:_]/g, " ") },
    });
  }
}

async function seedRoles() {
  for (const roleName of Object.values(SYSTEM_ROLES)) {
    const role = await db.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} system role`, isSystem: true },
    });

    const permissionKeys = DEFAULT_ROLE_PERMISSIONS[roleName];
    for (const key of permissionKeys) {
      const permission = await db.permission.findUniqueOrThrow({ where: { key } });
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function seedProducts() {
  const products: Array<{ key: string; name: string; amount: number; currency: string }> = [
    { key: "TARGET_UNLOCK", name: "TARGET & SAFE Results Unlock", amount: 9.99, currency: "EUR" },
    { key: "APPLICATION_FEE", name: "Application Submission Fee", amount: 15.0, currency: "EUR" },
    { key: "CONSULTATION_40MIN", name: "40-Minute Consultation", amount: 30.0, currency: "EUR" },
    {
      key: "ASSESSMENT_REVIEW",
      name: "Consultant Review of Your Assessment",
      amount: 10.0,
      currency: "EUR",
    },
  ];

  for (const p of products) {
    const product = await db.product.upsert({
      where: { key: p.key },
      update: {},
      create: { key: p.key, name: p.name, type: "ONE_TIME", isActive: true },
    });

    const existingPrice = await db.price.findFirst({
      where: { productId: product.id, currency: p.currency, isActive: true },
    });
    if (!existingPrice) {
      await db.price.create({
        data: {
          productId: product.id,
          amount: p.amount,
          currency: p.currency,
          billingInterval: "ONE_TIME",
          isActive: true,
        },
      });
    }
  }
}

async function seedFeatureFlags() {
  // DEMO_MODE flag mirrors the env var but is the runtime targeting mechanism —
  // docs/54-decision-log.md D-8 note, docs/46-feature-flags.md. The env var is the
  // hard gate (see src/lib/env.ts); this row lets it be targeted per-environment.
  await db.featureFlag.upsert({
    where: { key: "DEMO_MODE" },
    update: {},
    create: { key: "DEMO_MODE", description: "Enables demo-only UI affordances", isEnabled: false },
  });
}

/**
 * Scoring rules — docs/16-assessment-engine.md, docs/54-decision-log.md D-6.
 *
 * Seeded as version 1 and never mutated afterwards: an admin who retunes the weights
 * publishes a NEW version, so historical assessments stay explainable under the rules
 * that actually produced them.
 */
async function seedAssessmentRules() {
  const rules = [
    { key: "weights", ruleType: "WEIGHTED_FACTOR" as const, config: DEFAULT_RULES.weights },
    { key: "zone_thresholds", ruleType: "THRESHOLD" as const, config: DEFAULT_RULES.thresholds },
    { key: "safe_guardrails", ruleType: "THRESHOLD" as const, config: DEFAULT_RULES.safeGuardrails },
  ];

  for (const rule of rules) {
    await db.assessmentRule.upsert({
      where: { key_version: { key: rule.key, version: 1 } },
      update: {},
      create: {
        key: rule.key,
        version: 1,
        ruleType: rule.ruleType,
        config: { ...rule.config },
        isActive: true,
      },
    });
  }
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedProducts();
  await seedFeatureFlags();
  await seedAssessmentRules();
  await seedCatalog(db);
  await seedNotificationTemplates(db);
  await seedConsultantAvailability(db);
  await seedTestAccounts(db);
  console.log(
    "Seed complete: permissions, roles, products/prices, feature flags, rules, catalog, notification templates, consultant availability.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
