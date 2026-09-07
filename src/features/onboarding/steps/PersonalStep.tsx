"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { DOB_RANGE } from "@/features/onboarding/date-bounds";
import type { StepProps } from "../OnboardingWizard";

export function PersonalStep({ data, countries, save, isSaving }: StepProps) {
  const { profile } = data;
  const [values, setValues] = useState({
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    dateOfBirth: profile.dateOfBirth?.slice(0, 10) ?? "",
    phone: profile.phone ?? "",
    nationalityCountryId: profile.nationalityCountryId ?? "",
    currentCountryId: profile.currentCountryId ?? "",
  });

  function update(field: keyof typeof values) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await save({
      step: "personal",
      ...values,
      dateOfBirth: values.dateOfBirth || null,
      phone: values.phone || null,
      nationalityCountryId: values.nationalityCountryId || null,
      currentCountryId: values.currentCountryId || null,
    }).catch(() => {});
  }

  return (
    <form onSubmit={handleSave}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="First name">
          <Input value={values.firstName} onChange={update("firstName")} required />
        </FormField>
        <FormField label="Last name">
          <Input value={values.lastName} onChange={update("lastName")} required />
        </FormField>
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="Date of birth">
          <Input
            type="date"
            value={values.dateOfBirth}
            onChange={update("dateOfBirth")}
            min={DOB_RANGE.min}
            max={DOB_RANGE.max}
          />
        </FormField>
        <FormField label="Phone" hint="Optional">
          <Input value={values.phone} onChange={update("phone")} />
        </FormField>
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="Nationality">
          <Select value={values.nationalityCountryId} onChange={update("nationalityCountryId")}>
            <option value="">Select a country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Country you live in now">
          <Select value={values.currentCountryId} onChange={update("currentCountryId")}>
            <option value="">Select a country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <Button type="submit" isLoading={isSaving}>
        Save
      </Button>
    </form>
  );
}
