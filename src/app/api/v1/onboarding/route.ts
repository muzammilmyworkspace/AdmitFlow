import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { requireVerifiedActor, requireOwnProfileId } from "@/lib/auth/guards";
import {
  addEducation,
  addLanguageTest,
  completeOnboarding,
  deleteEducation,
  deleteLanguageTest,
  getOnboardingStatus,
  getProfile,
  setBudget,
  setDestinations,
  setPreferences,
  updatePersonal,
} from "@/services/profile-service";

// GET  /api/v1/onboarding — current profile + derived step completion
// PATCH /api/v1/onboarding — writes one step at a time (autosave-friendly)
// The step is a discriminated union so each step's payload is validated on its own terms
// rather than one loose partial object where everything is optional.

const stepSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("personal"),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    dateOfBirth: z.string().nullish(),
    phone: z.string().max(40).nullish(),
    nationalityCountryId: z.string().uuid().nullish(),
    currentCountryId: z.string().uuid().nullish(),
  }),
  z.object({
    step: z.literal("addEducation"),
    level: z.enum(["HIGH_SCHOOL", "BACHELORS", "MASTERS", "DOCTORATE", "OTHER"]),
    institutionName: z.string().min(1).max(200),
    countryId: z.string().uuid(),
    fieldOfStudy: z.string().max(200).nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    isCurrent: z.boolean().default(false),
    gradingScale: z.enum(["GPA_4", "GPA_5", "PERCENTAGE", "UK_HONOURS", "OTHER"]),
    gradeValue: z.number().nullish(),
  }),
  z.object({ step: z.literal("deleteEducation"), educationId: z.string().uuid() }),
  z.object({
    step: z.literal("destination"),
    countryIds: z.array(z.string().uuid()).min(1).max(5),
    targetIntake: z.string().max(60).nullish(),
  }),
  z.object({
    step: z.literal("budget"),
    budgetMin: z.number().nonnegative().nullish(),
    budgetMax: z.number().positive(),
    currency: z.string().length(3),
  }),
  z.object({
    step: z.literal("addLanguageTest"),
    testType: z.enum(["IELTS", "TOEFL", "PTE", "DUOLINGO", "CAMBRIDGE", "OTHER"]),
    overallScore: z.number(),
    sectionScores: z.record(z.string(), z.number()).optional(),
    testDate: z.string(),
    expiryDate: z.string().nullish(),
  }),
  z.object({ step: z.literal("deleteLanguageTest"), testId: z.string().uuid() }),
  z.object({
    step: z.literal("preferences"),
    studyMode: z.enum(["ON_CAMPUS", "ONLINE", "HYBRID", "NO_PREFERENCE"]),
    campusSizePreference: z.enum(["SMALL", "MEDIUM", "LARGE", "NO_PREFERENCE"]),
    scholarshipPriority: z.enum(["LOW", "MEDIUM", "HIGH"]),
    intakePreference: z.string().max(60).nullish(),
  }),
  z.object({ step: z.literal("complete") }),
]);

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const profileId = await requireOwnProfileId(actor);
    const [profile, status] = await Promise.all([
      getProfile(profileId),
      getOnboardingStatus(profileId),
    ]);
    return ok({ profile, status, accountStatus: actor.status }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const profileId = await requireOwnProfileId(actor);
    const body = await parseBody(request, stepSchema);

    switch (body.step) {
      case "personal":
        await updatePersonal(profileId, body);
        break;
      case "addEducation":
        await addEducation(profileId, body);
        break;
      case "deleteEducation":
        await deleteEducation(profileId, body.educationId);
        break;
      case "destination":
        await setDestinations(profileId, body.countryIds, body.targetIntake);
        break;
      case "budget":
        await setBudget(profileId, body);
        break;
      case "addLanguageTest":
        await addLanguageTest(profileId, body);
        break;
      case "deleteLanguageTest":
        await deleteLanguageTest(profileId, body.testId);
        break;
      case "preferences":
        await setPreferences(profileId, body);
        break;
      case "complete":
        await completeOnboarding(actor.userId, profileId);
        break;
    }

    const [profile, status] = await Promise.all([
      getProfile(profileId),
      getOnboardingStatus(profileId),
    ]);
    return ok({ profile, status }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
