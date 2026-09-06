export interface FactorView {
  factorKey: string;
  weight: number;
  rawScore: number;
  reasoning: string;
  skipped: boolean;
}

export interface UnlockedResultView {
  locked: false;
  programId: string;
  zone: string;
  overallScore: number;
  eligibilityStatus: string;
  program: {
    name: string;
    level: string;
    fieldOfStudy: string;
    durationMonths: number;
    deliveryMode: string;
    university: string;
    country: string;
    city: string | null;
    worldRanking: number | null;
  };
  tuition: { amount: number; currency: string; perPeriod: string } | null;
  nextIntake: { term: string; status: string; applicationDeadline: string } | null;
  factors: FactorView[];
  strengths: string[];
  weaknesses: string[];
  missingRequirements: string[];
  flags: string[];
  reasoning: string;
  dataFreshness: { verifiedAt: string | null; isStale: boolean; source: string | null };
}

export interface LockedResultView {
  locked: true;
  placeholderId: string;
  zone: string;
}

export type ResultView = UnlockedResultView | LockedResultView;

export interface AssessmentResultsView {
  assessmentId: string;
  resultId: string;
  generatedAt: string;
  matchingEngineVersion: string;
  rulesVersion: string;
  universityDataVersion: string;
  results: ResultView[];
  counts: { REACH: number; TARGET: number; SAFE: number };
  lockedCounts: { TARGET: number; SAFE: number };
  entitlements: { target: boolean; safe: boolean };
  freePreviewCount: number;
}

export interface AssessmentHistoryEntry {
  id: string;
  generatedAt: string;
  matchingEngineVersion: string;
  rulesVersion: string;
}

export interface AssessmentResponse {
  results: AssessmentResultsView | null;
  history: AssessmentHistoryEntry[];
}
