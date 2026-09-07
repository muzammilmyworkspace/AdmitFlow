import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { requireVerifiedActor, requireOwnProfileId } from "@/lib/auth/guards";
import {
  assertDateOrder,
  currencyCode,
  dateOfBirth,
  isoDate,
  money,
  optionalText,
  pastDate,
  phone,
  shortText,
  studyDate,
} from "@/lib/validation";
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
    firstName: shortText(100, "First name"),
    lastName: shortText(100, "Last name"),
    dateOfBirth: dateOfBirth.nullish(),
    phone: phone,
    nationalityCountryId: z.string().uuid().nullish(),
    currentCountryId: z.string().uuid().nullish(),
  }),
  z.object({
    step: z.literal("addEducation"),
    level: z.enum(["HIGH_SCHOOL", "BACHELORS", "MASTERS", "DOCTORATE", "OTHER"]),
    institutionName: shortText(200, "Institution name"),
    countryId: z.string().uuid(),
    fieldOfStudy: optionalText(200),
    startDate: studyDate.nullish(),
    endDate: studyDate.nullish(),
    isCurrent: z.boolean().default(false),
    gradingScale: z.enum(["GPA_4", "GPA_5", "PERCENTAGE", "UK_HONOURS", "OTHER"]),
    // Per-scale bounds are enforced in the service, which knows the scale; this only
    // rules out values no scale could ever produce.
    gradeValue: z.number().finite().min(0).max(1000).nullish(),
  }),
  z.object({ step: z.literal("deleteEducation"), educationId: z.string().uuid() }),
  z.object({
    step: z.literal("destination"),
    countryIds: z.array(z.string().uuid()).min(1).max(5),
    targetIntake: optionalText(60),
  }),
  z.object({
    step: z.literal("budget"),
    budgetMin: money.nullish(),
    budgetMax: money,
    currency: currencyCode,
  }),
  z.object({
    step: z.literal("addLanguageTest"),
    testType: z.enum(["IELTS", "TOEFL", "PTE", "DUOLINGO", "CAMBRIDGE", "OTHER"]),
    // Per-test ranges are enforced in the service; this rules out absurd input early.
    overallScore: z.number().finite().min(0).max(1000),
    sectionScores: z.record(z.string(), z.number().finite()).optional(),
    // A test cannot have been sat in the future.
    testDate: pastDate,
    expiryDate: isoDate.nullish(),
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
])
  // Cross-field rules live here rather than on the individual members: a discriminated
  // union only accepts plain object schemas, and .refine() turns a member into a
  // ZodEffects that the union rejects.
  .superRefine((value, ctx) => {
    if (value.step === "addEducation" && !assertDateOrder(value.startDate, value.endDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "The end date cannot be before the start date.",
      });
    }
    if (value.step === "addLanguageTest" && !assertDateOrder(value.testDate, value.expiryDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiryDate"],
        message: "The expiry date cannot be before the test date.",
      });
    }
    if (
      value.step === "budget" &&
      value.budgetMin != null &&
      value.budgetMin > value.budgetMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budgetMin"],
        message: "The minimum budget cannot exceed the maximum.",
      });
    }
  });

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
