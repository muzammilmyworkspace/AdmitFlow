import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import type {
  CampusSizePreference,
  EducationLevel,
  GradingScale,
  LanguageTestType,
  ScholarshipPriority,
  StudyMode,
} from "../../prisma/generated/client";

// Student profile + onboarding — docs/01-product-requirements.md §"Onboarding",
// docs/04-functional-requirements.md. Every write is scoped to the caller's own profile
// id, resolved from their session, never accepted from the request body.

export interface OnboardingStatus {
  profileId: string;
  steps: {
    personal: boolean;
    education: boolean;
    destination: boolean;
    budget: boolean;
    english: boolean;
    preferences: boolean;
  };
  completedCount: number;
  totalSteps: number;
  isComplete: boolean;
  completedAt: Date | null;
}

/**
 * Which onboarding steps are satisfied.
 *
 * This is a *derived* view of the data, deliberately not a stored "current step"
 * counter: a stored pointer goes stale the moment a student edits an earlier section
 * from their settings, and then the wizard lies about what's missing.
 */
export async function getOnboardingStatus(profileId: string): Promise<OnboardingStatus> {
  const profile = await db.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      educations: true,
      languageTests: true,
      preference: true,
      destinationCountries: true,
    },
  });

  const steps = {
    personal: !!(profile.firstName && profile.lastName && profile.dateOfBirth),
    education: profile.educations.length > 0,
    destination: profile.destinationCountries.length > 0,
    budget: profile.budgetMax !== null && profile.budgetCurrency !== null,
    // "No test yet" is a valid answer, recorded on Preference, so this step is satisfied
    // either by a real test result or by explicitly declaring there isn't one.
    english: profile.languageTests.length > 0 || !!profile.preference,
    preferences: !!profile.preference,
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalSteps = Object.keys(steps).length;

  return {
    profileId,
    steps,
    completedCount,
    totalSteps,
    isComplete: completedCount === totalSteps,
    completedAt: profile.onboardingCompletedAt,
  };
}

export async function getProfile(profileId: string) {
  return db.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      educations: { include: { country: true }, orderBy: { createdAt: "asc" } },
      languageTests: { orderBy: { testDate: "desc" } },
      preference: true,
      destinationCountries: { include: { country: true }, orderBy: { rank: "asc" } },
      nationalityCountry: true,
      currentCountry: true,
    },
  });
}

export async function updatePersonal(
  profileId: string,
  input: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
    phone?: string | null;
    nationalityCountryId?: string | null;
    currentCountryId?: string | null;
  },
) {
  return db.profile.update({
    where: { id: profileId },
    data: {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: input.phone?.trim() || null,
      nationalityCountryId: input.nationalityCountryId || null,
      currentCountryId: input.currentCountryId || null,
    },
  });
}

export async function addEducation(
  profileId: string,
  input: {
    level: EducationLevel;
    institutionName: string;
    countryId: string;
    fieldOfStudy?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent: boolean;
    gradingScale: GradingScale;
    gradeValue?: number | null;
  },
) {
  validateGrade(input.gradingScale, input.gradeValue ?? null);
  return db.education.create({
    data: {
      profileId,
      level: input.level,
      institutionName: input.institutionName.trim(),
      countryId: input.countryId,
      fieldOfStudy: input.fieldOfStudy?.trim() || null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      isCurrent: input.isCurrent,
      gradingScale: input.gradingScale,
      gradeValue: input.gradeValue ?? null,
    },
  });
}

export async function deleteEducation(profileId: string, educationId: string) {
  // Ownership is enforced in the WHERE clause, not by a separate read-then-check:
  // deleteMany with both ids means another student's row simply matches nothing.
  const result = await db.education.deleteMany({ where: { id: educationId, profileId } });
  if (result.count === 0) throw new AppError("RESOURCE_NOT_FOUND", "Education entry not found.");
}

/**
 * Grade bounds per grading scale — docs/30-validation-rules.md §3.
 * A GPA of 9.2 on a 4.0 scale is a data-entry error that would silently wreck the
 * academic score, so it is rejected at the boundary rather than clamped.
 */
function validateGrade(scale: GradingScale, value: number | null) {
  if (value === null) return;
  const bounds: Record<GradingScale, [number, number]> = {
    GPA_4: [0, 4],
    GPA_5: [0, 5],
    PERCENTAGE: [0, 100],
    UK_HONOURS: [0, 100],
    OTHER: [0, 100],
  };
  const [min, max] = bounds[scale];
  if (value < min || value > max) {
    throw new AppError(
      "VALIDATION_ERROR",
      `A grade of ${value} is outside the valid range for this grading scale (${min}–${max}).`,
    );
  }
}

export async function setDestinations(
  profileId: string,
  countryIds: string[],
  targetIntake?: string | null,
) {
  if (countryIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Choose at least one destination country.");
  }
  await db.$transaction(async (tx) => {
    await tx.profileDestinationCountry.deleteMany({ where: { profileId } });
    await tx.profileDestinationCountry.createMany({
      data: countryIds.map((countryId, index) => ({ profileId, countryId, rank: index + 1 })),
    });
    if (targetIntake !== undefined) {
      await tx.preference.upsert({
        where: { profileId },
        create: { profileId, intakePreference: targetIntake },
        update: { intakePreference: targetIntake },
      });
    }
  });
}

export async function setBudget(
  profileId: string,
  input: { budgetMin?: number | null; budgetMax: number; currency: string },
) {
  if (input.budgetMax <= 0) {
    throw new AppError("VALIDATION_ERROR", "Your budget must be greater than zero.");
  }
  if (input.budgetMin != null && input.budgetMin > input.budgetMax) {
    throw new AppError("VALIDATION_ERROR", "The minimum budget cannot exceed the maximum.");
  }
  return db.profile.update({
    where: { id: profileId },
    data: {
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax,
      budgetCurrency: input.currency.toUpperCase(),
    },
  });
}

export async function addLanguageTest(
  profileId: string,
  input: {
    testType: LanguageTestType;
    overallScore: number;
    sectionScores?: Record<string, number>;
    testDate: string;
    expiryDate?: string | null;
  },
) {
  validateLanguageScore(input.testType, input.overallScore);
  return db.languageTest.create({
    data: {
      profileId,
      testType: input.testType,
      overallScore: input.overallScore,
      sectionScores: input.sectionScores ?? {},
      testDate: new Date(input.testDate),
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
    },
  });
}

export async function deleteLanguageTest(profileId: string, testId: string) {
  const result = await db.languageTest.deleteMany({ where: { id: testId, profileId } });
  if (result.count === 0) throw new AppError("RESOURCE_NOT_FOUND", "Test result not found.");
}

/** Valid score ranges per test — a 9.5 IELTS or a 200 TOEFL is a typo, not a score. */
export const LANGUAGE_TEST_RANGES: Record<LanguageTestType, [number, number]> = {
  IELTS: [0, 9],
  TOEFL: [0, 120],
  PTE: [10, 90],
  DUOLINGO: [10, 160],
  CAMBRIDGE: [80, 230],
  OTHER: [0, 100],
};

function validateLanguageScore(testType: LanguageTestType, score: number) {
  const [min, max] = LANGUAGE_TEST_RANGES[testType];
  if (score < min || score > max) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${testType} scores run from ${min} to ${max} — ${score} is outside that range.`,
    );
  }
}

export async function setPreferences(
  profileId: string,
  input: {
    studyMode: StudyMode;
    campusSizePreference: CampusSizePreference;
    scholarshipPriority: ScholarshipPriority;
    intakePreference?: string | null;
  },
) {
  // Fields are listed explicitly rather than spread: callers pass the parsed request
  // body, which carries a `step` discriminator that is not a column.
  const data = {
    studyMode: input.studyMode,
    campusSizePreference: input.campusSizePreference,
    scholarshipPriority: input.scholarshipPriority,
    intakePreference: input.intakePreference ?? null,
  };
  return db.preference.upsert({
    where: { profileId },
    create: { profileId, ...data },
    update: data,
  });
}

/**
 * Completes onboarding: ONBOARDING -> ACTIVE (docs/31-state-machines.md §1, A5).
 * Refuses when steps are still missing rather than letting a half-filled profile through
 * — the assessment engine's output is only as honest as its inputs.
 */
export async function completeOnboarding(userId: string, profileId: string) {
  const status = await getOnboardingStatus(profileId);
  if (!status.isComplete) {
    const missing = Object.entries(status.steps)
      .filter(([, done]) => !done)
      .map(([step]) => step);
    throw new AppError(
      "VALIDATION_ERROR",
      `Finish these sections first: ${missing.join(", ")}.`,
    );
  }

  return db.$transaction(async (tx) => {
    await tx.profile.update({
      where: { id: profileId },
      data: { onboardingCompletedAt: new Date() },
    });
    const user = await tx.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
    });
    await writeAuditLog(
      {
        actorId: userId,
        actorType: "STUDENT",
        action: "user.onboarding_completed",
        entityType: "User",
        entityId: userId,
      },
      tx,
    );
    return user;
  });
}
