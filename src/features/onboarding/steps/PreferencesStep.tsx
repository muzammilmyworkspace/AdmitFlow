"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import type { StepProps } from "../OnboardingWizard";

export function PreferencesStep({ data, save, isSaving }: StepProps) {
  const pref = data.profile.preference;
  const [values, setValues] = useState({
    studyMode: pref?.studyMode ?? "NO_PREFERENCE",
    campusSizePreference: pref?.campusSizePreference ?? "NO_PREFERENCE",
    scholarshipPriority: pref?.scholarshipPriority ?? "MEDIUM",
    intakePreference: pref?.intakePreference ?? "",
  });

  function update(field: keyof typeof values) {
    return (event: React.ChangeEvent<HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await save({
      step: "preferences",
      ...values,
      intakePreference: values.intakePreference || null,
    }).catch(() => {});
  }

  return (
    <form onSubmit={handleSave}>
      <p className="mb-4 text-sm text-text-secondary">
        These shape your ranking, but never rule a programme out on their own.
      </p>

      <FormField label="Study mode">
        <Select value={values.studyMode} onChange={update("studyMode")}>
          <option value="NO_PREFERENCE">No preference</option>
          <option value="ON_CAMPUS">On campus</option>
          <option value="HYBRID">Hybrid</option>
          <option value="ONLINE">Online</option>
        </Select>
      </FormField>

      <FormField label="Campus size">
        <Select value={values.campusSizePreference} onChange={update("campusSizePreference")}>
          <option value="NO_PREFERENCE">No preference</option>
          <option value="SMALL">Small</option>
          <option value="MEDIUM">Medium</option>
          <option value="LARGE">Large</option>
        </Select>
      </FormField>

      <FormField
        label="How important is scholarship availability?"
        hint="Raises programmes that offer funding you might qualify for."
      >
        <Select value={values.scholarshipPriority} onChange={update("scholarshipPriority")}>
          <option value="LOW">Not important</option>
          <option value="MEDIUM">Somewhat important</option>
          <option value="HIGH">Very important</option>
        </Select>
      </FormField>

      <Button type="submit" isLoading={isSaving}>
        Save
      </Button>
    </form>
  );
}
