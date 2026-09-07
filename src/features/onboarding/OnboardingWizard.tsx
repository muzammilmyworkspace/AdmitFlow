"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
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
      <nav aria-label="Onboarding steps" className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-5 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-sm font-medium text-text-primary">Your progress</span>
            <span className="text-sm font-semibold tabular-nums text-secondary-700">
              {Math.round((status.completedCount / status.totalSteps) * 100)}%
            </span>
          </div>
          <ProgressBar
            value={status.completedCount}
            max={status.totalSteps}
            label={`${status.completedCount} of ${status.totalSteps} sections complete`}
          />
          <p className="mt-2.5 text-xs text-text-secondary">
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
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-fast ${
                    isActive
                      ? "bg-primary-50 font-medium text-primary-700"
                      : "text-text-secondary hover:bg-bg hover:text-text-primary"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? "bg-brand-gradient text-white"
                        : isActive
                          ? "bg-primary text-white"
                          : "bg-bg text-text-muted ring-1 ring-inset ring-border"
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                  </span>
                  {step.title}
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

          <div className="mt-7 flex items-center justify-between border-t border-border pt-5">
            <Button
              variant="ghost"
              disabled={currentIndex === 0}
              onClick={() => setActiveStep(STEPS[currentIndex - 1]!.key)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            {currentIndex < STEPS.length - 1 ? (
              <Button variant="subtle" onClick={() => setActiveStep(STEPS[currentIndex + 1]!.key)}>
                Next
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                isLoading={isSaving}
                disabled={!status.isComplete}
                size="lg"
              >
                Finish and see my matches
                <ArrowRight className="h-4 w-4" aria-hidden />
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
