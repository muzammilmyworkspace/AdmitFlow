// Shared shapes between the onboarding wizard steps and the API responses.

export interface CountryOption {
  id: string;
  isoCode2: string;
  name: string;
  region: string | null;
}

export interface EducationEntry {
  id: string;
  level: string;
  institutionName: string;
  fieldOfStudy: string | null;
  gradingScale: string;
  gradeValue: string | number | null;
  isCurrent: boolean;
  country: { id: string; name: string } | null;
}

export interface LanguageTestEntry {
  id: string;
  testType: string;
  overallScore: string | number;
  testDate: string;
  expiryDate: string | null;
}

export interface OnboardingProfile {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  nationalityCountryId: string | null;
  currentCountryId: string | null;
  budgetMin: string | number | null;
  budgetMax: string | number | null;
  budgetCurrency: string | null;
  onboardingCompletedAt: string | null;
  educations: EducationEntry[];
  languageTests: LanguageTestEntry[];
  destinationCountries: { countryId: string; rank: number; country: { name: string } }[];
  preference: {
    studyMode: string;
    campusSizePreference: string;
    scholarshipPriority: string;
    intakePreference: string | null;
  } | null;
}

export interface OnboardingStatus {
  profileId: string;
  steps: Record<string, boolean>;
  completedCount: number;
  totalSteps: number;
  isComplete: boolean;
  completedAt: string | null;
}

export interface OnboardingResponse {
  profile: OnboardingProfile;
  status: OnboardingStatus;
  accountStatus?: string;
}
