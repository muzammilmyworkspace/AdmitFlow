"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormField } from "@/components/ui/FormField";
import type { StepProps } from "../OnboardingWizard";

export function DestinationStep({ data, countries, save, isSaving }: StepProps) {
  const [selected, setSelected] = useState<string[]>(
    data.profile.destinationCountries.map((d) => d.countryId),
  );
  const [targetIntake, setTargetIntake] = useState(
    data.profile.preference?.intakePreference ?? "",
  );

  function toggle(countryId: string) {
    setSelected((prev) =>
      prev.includes(countryId) ? prev.filter((id) => id !== countryId) : [...prev, countryId],
    );
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await save({
      step: "destination",
      countryIds: selected,
      targetIntake: targetIntake || null,
    }).catch(() => {});
  }

  return (
    <form onSubmit={handleSave}>
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium text-text-primary">
          Where would you like to study?
        </legend>
        <p className="mb-3 text-sm text-text-secondary">
          Pick up to 5. The order you pick them in sets your preference ranking.
        </p>
        {countries.map((country) => (
          <Checkbox
            key={country.id}
            label={country.name}
            checked={selected.includes(country.id)}
            onChange={() => toggle(country.id)}
            disabled={!selected.includes(country.id) && selected.length >= 5}
          />
        ))}
      </fieldset>

      <FormField label="Target intake" hint="For example: Fall 2026">
        <Input value={targetIntake} onChange={(e) => setTargetIntake(e.target.value)} />
      </FormField>

      <Button type="submit" isLoading={isSaving} disabled={selected.length === 0}>
        Save
      </Button>
    </form>
  );
}
