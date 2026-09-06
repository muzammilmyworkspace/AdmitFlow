"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Badge } from "@/components/ui/Badge";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";
import type { CountryOption, OnboardingResponse } from "./types";
import { PersonalStep } from "./steps/PersonalStep";
import { EducationStep } from "./steps/EducationStep";
import { DestinationStep } from "./steps/DestinationStep";
import { BudgetStep } from "./steps/BudgetStep";
import { EnglishStep } from "./steps/EnglishStep";
import { PreferencesStep } from "./steps/PreferencesStep";

const STEPS = [
  { key: "personal", title: "About you" },
  { key: "education", title: "Education" },
  { key: "destination", title: "Where you want to study" },
  { key: "budget", title: "Budget" },
  { key: "english", title: "English proficiency" },
  { key: "preferences", title: "Preferences" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export function OnboardingWizard() {
  const router = useRouter();
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [activeStep, setActiveStep] = useState<StepKey>("personal");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const [onboarding, reference] = await Promise.all([
      apiGet<OnboardingResponse>("/api/v1/onboarding"),
      apiGet<{ countries: CountryOption[] }>("/api/v1/reference/countries"),
    ]);
    setData(onboarding);
    setCountries(reference.countries);
    return onboarding;
  }, []);

  useEffect(() => {
    load()
      .then((onboarding) => {
        // Resume where the student left off rather than always restarting at step 1 —
        // the first incomplete step is the useful landing point on return.
        const firstIncomplete = STEPS.find((s) => !onboarding.status.steps[s.key]);
        if (firstIncomplete) setActiveStep(firstIncomplete.key);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your profile."))
      .finally(() => setIsLoading(false));
  }, [load]);

  /** Every step writes through this, so autosave and error handling exist once. */
  const save = useCallback(
    async (payload: Record<string, unknown>) => {
      setIsSaving(true);
      setError(null);
      try {
        const result = await apiPatch<OnboardingResponse>("/api/v1/onboarding", payload);
        setData(result);
        return result;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not save. Please try again.");
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  async function handleFinish() {
    try {
      await save({ step: "complete" });
      router.push("/dashboard");
      router.refresh();
    } catch {
      // The error is already surfaced by save(); staying put lets the student fix it.
    }
  }

  if (isLoading) {
    return (
      <Card className="flex items-center gap-3">
        <Spinner className="text-primary" />
        <span className="text-sm text-text-secondary">Loading your profile…</span>
      </Card>
    );
  }

  if (!data) {
    return <Alert tone="error">{error ?? "Could not load your profile."}</Alert>;
  }

  const { status } = data;
  const currentIndex = STEPS.findIndex((s) => s.key === activeStep);
  const stepProps = { data, countries, save, isSaving };

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Onboarding steps" className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-4">
          <ProgressBar
            value={status.completedCount}
            max={status.totalSteps}
            label={`${status.completedCount} of ${status.totalSteps} sections complete`}
          />
          <p className="mt-2 text-xs text-text-secondary">
            {status.completedCount} of {status.totalSteps} sections complete
          </p>
        </div>
        <ol className="space-y-1">
          {STEPS.map((step, index) => {
            const done = status.steps[step.key];
            const isActive = step.key === activeStep;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => setActiveStep(step.key)}
                  aria-current={isActive ? "step" : undefined}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors duration-fast ${
                    isActive
                      ? "bg-primary text-white"
                      : "text-text-primary hover:bg-text-secondary/10"
                  }`}
                >
                  <span>
                    {index + 1}. {step.title}
                  </span>
                  {done && (
                    <span aria-label="complete" className={isActive ? "text-white" : "text-success"}>
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div>
        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}

        <Card>
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text-primary">{STEPS[currentIndex]?.title}</h2>
            {status.steps[activeStep] && <Badge tone="success">Complete</Badge>}
          </div>

          {activeStep === "personal" && <PersonalStep {...stepProps} />}
          {activeStep === "education" && <EducationStep {...stepProps} />}
          {activeStep === "destination" && <DestinationStep {...stepProps} />}
          {activeStep === "budget" && <BudgetStep {...stepProps} />}
          {activeStep === "english" && <EnglishStep {...stepProps} />}
          {activeStep === "preferences" && <PreferencesStep {...stepProps} />}

          <div className="mt-6 flex items-center justify-between border-t border-text-secondary/15 pt-5">
            <Button
              variant="ghost"
              disabled={currentIndex === 0}
              onClick={() => setActiveStep(STEPS[currentIndex - 1]!.key)}
            >
              Back
            </Button>
            {currentIndex < STEPS.length - 1 ? (
              <Button onClick={() => setActiveStep(STEPS[currentIndex + 1]!.key)}>Next</Button>
            ) : (
              <Button onClick={handleFinish} isLoading={isSaving} disabled={!status.isComplete}>
                Finish and see my matches
              </Button>
            )}
          </div>

          {currentIndex === STEPS.length - 1 && !status.isComplete && (
            <p className="mt-3 text-sm text-text-secondary">
              Finish every section to run your first assessment.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

export interface StepProps {
  data: OnboardingResponse;
  countries: CountryOption[];
  save: (payload: Record<string, unknown>) => Promise<OnboardingResponse>;
  isSaving: boolean;
}
