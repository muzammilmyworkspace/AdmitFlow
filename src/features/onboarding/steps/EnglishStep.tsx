"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import type { StepProps } from "../OnboardingWizard";

const TEST_TYPES = [
  ["IELTS", "IELTS (0–9)"],
  ["TOEFL", "TOEFL iBT (0–120)"],
  ["PTE", "PTE Academic (10–90)"],
  ["DUOLINGO", "Duolingo English Test (10–160)"],
  ["CAMBRIDGE", "Cambridge English (80–230)"],
  ["OTHER", "Other (0–100)"],
] as const;

export function EnglishStep({ data, save, isSaving }: StepProps) {
  const [form, setForm] = useState({ testType: "IELTS", overallScore: "", testDate: "" });
  const [showForm, setShowForm] = useState(false);
  const tests = data.profile.languageTests;

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    try {
      await save({
        step: "addLanguageTest",
        testType: form.testType,
        overallScore: Number(form.overallScore),
        testDate: form.testDate,
      });
      setForm({ testType: "IELTS", overallScore: "", testDate: "" });
      setShowForm(false);
    } catch {
      // Message already surfaced by save().
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-text-secondary">
        Add a test result if you have one. If you don&apos;t yet, that&apos;s fine — you can
        continue without it, and we&apos;ll estimate conservatively and mark those matches so
        you know the difference.
      </p>

      {tests.length > 0 ? (
        <ul className="mb-5 space-y-3">
          {tests.map((test) => (
            <li
              key={test.id}
              className="flex items-center justify-between gap-4 rounded-md border border-text-secondary/15 p-4"
            >
              <div>
                <p className="font-medium text-text-primary">
                  {test.testType}{" "}
                  <Badge tone="primary">{String(test.overallScore)}</Badge>
                </p>
                <p className="text-sm text-text-secondary">
                  Taken {test.testDate.slice(0, 10)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => save({ step: "deleteLanguageTest", testId: test.id }).catch(() => {})}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Alert tone="info" className="mb-5">
          No test result recorded. Matches will use a conservative estimate and be flagged as
          pending a real score.
        </Alert>
      )}

      {showForm ? (
        <form onSubmit={handleAdd} className="rounded-md border border-text-secondary/15 p-4">
          <div className="grid gap-x-4 sm:grid-cols-3">
            <FormField label="Test">
              <Select
                value={form.testType}
                onChange={(e) => setForm({ ...form, testType: e.target.value })}
              >
                {TEST_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Overall score">
              <Input
                type="number"
                step="0.5"
                value={form.overallScore}
                onChange={(e) => setForm({ ...form, overallScore: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Test date">
              <Input
                type="date"
                value={form.testDate}
                onChange={(e) => setForm({ ...form, testDate: e.target.value })}
                required
              />
            </FormField>
          </div>
          <div className="flex gap-2">
            <Button type="submit" isLoading={isSaving}>
              Add result
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setShowForm(true)}>
          Add a test result
        </Button>
      )}
    </div>
  );
}
