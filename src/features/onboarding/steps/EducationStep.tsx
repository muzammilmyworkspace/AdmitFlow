"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import type { StepProps } from "../OnboardingWizard";

const LEVELS = [
  ["HIGH_SCHOOL", "High school"],
  ["BACHELORS", "Bachelor's"],
  ["MASTERS", "Master's"],
  ["DOCTORATE", "Doctorate"],
  ["OTHER", "Other"],
] as const;

const SCALES = [
  ["GPA_4", "GPA (out of 4.0)"],
  ["GPA_5", "GPA (out of 5.0)"],
  ["PERCENTAGE", "Percentage (0–100)"],
  ["UK_HONOURS", "UK honours (0–100)"],
  ["OTHER", "Other (0–100)"],
] as const;

const EMPTY_FORM = {
  level: "BACHELORS",
  institutionName: "",
  countryId: "",
  fieldOfStudy: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  gradingScale: "GPA_4",
  gradeValue: "",
};

export function EducationStep({ data, countries, save, isSaving }: StepProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(data.profile.educations.length === 0);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    try {
      await save({
        step: "addEducation",
        ...form,
        fieldOfStudy: form.fieldOfStudy || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        gradeValue: form.gradeValue === "" ? null : Number(form.gradeValue),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch {
      // save() already surfaced the message; keep the form filled so it can be corrected.
    }
  }

  return (
    <div>
      {data.profile.educations.length === 0 && !showForm ? (
        <EmptyState
          title="No education added yet"
          description="Add at least one qualification so we can assess your academic eligibility."
          action={<Button onClick={() => setShowForm(true)}>Add education</Button>}
        />
      ) : (
        <ul className="mb-5 space-y-3">
          {data.profile.educations.map((edu) => (
            <li
              key={edu.id}
              className="flex items-start justify-between gap-4 rounded-md border border-text-secondary/15 p-4"
            >
              <div>
                <p className="font-medium text-text-primary">{edu.institutionName}</p>
                <p className="text-sm text-text-secondary">
                  {edu.level.replace("_", " ").toLowerCase()}
                  {edu.fieldOfStudy ? ` · ${edu.fieldOfStudy}` : ""}
                  {edu.country ? ` · ${edu.country.name}` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  {edu.gradeValue !== null && (
                    <Badge tone="primary">
                      {String(edu.gradeValue)} ({edu.gradingScale.replace("_", " ")})
                    </Badge>
                  )}
                  {edu.isCurrent && <Badge tone="info">Currently studying</Badge>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => save({ step: "deleteEducation", educationId: edu.id }).catch(() => {})}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form onSubmit={handleAdd} className="rounded-md border border-text-secondary/15 p-4">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="Level">
              <Select
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
              >
                {LEVELS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Institution">
              <Input
                value={form.institutionName}
                onChange={(e) => setForm({ ...form, institutionName: e.target.value })}
                required
              />
            </FormField>
          </div>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="Country">
              <Select
                value={form.countryId}
                onChange={(e) => setForm({ ...form, countryId: e.target.value })}
                required
              >
                <option value="">Select a country</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Field of study" hint="Optional">
              <Input
                value={form.fieldOfStudy}
                onChange={(e) => setForm({ ...form, fieldOfStudy: e.target.value })}
              />
            </FormField>
          </div>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="Grading scale">
              <Select
                value={form.gradingScale}
                onChange={(e) => setForm({ ...form, gradingScale: e.target.value })}
              >
                {SCALES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Your grade">
              <Input
                type="number"
                step="0.01"
                value={form.gradeValue}
                onChange={(e) => setForm({ ...form, gradeValue: e.target.value })}
                required
              />
            </FormField>
          </div>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="Start date" hint="Optional">
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End date" hint="Leave blank if ongoing">
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormField>
          </div>

          <Checkbox
            label="I am currently studying here"
            checked={form.isCurrent}
            onChange={(e) => setForm({ ...form, isCurrent: e.target.checked })}
          />

          <div className="flex gap-2">
            <Button type="submit" isLoading={isSaving}>
              Add
            </Button>
            {data.profile.educations.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setShowForm(true)}>
          Add another qualification
        </Button>
      )}
    </div>
  );
}
