"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import type { StepProps } from "../OnboardingWizard";

const CURRENCIES = ["EUR", "USD", "GBP", "CAD", "AUD", "PKR", "INR"] as const;

export function BudgetStep({ data, save, isSaving }: StepProps) {
  const { profile } = data;
  const [budgetMax, setBudgetMax] = useState(
    profile.budgetMax !== null ? String(profile.budgetMax) : "",
  );
  const [budgetMin, setBudgetMin] = useState(
    profile.budgetMin !== null ? String(profile.budgetMin) : "",
  );
  const [currency, setCurrency] = useState(profile.budgetCurrency ?? "EUR");

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await save({
      step: "budget",
      budgetMin: budgetMin === "" ? null : Number(budgetMin),
      budgetMax: Number(budgetMax),
      currency,
    }).catch(() => {});
  }

  return (
    <form onSubmit={handleSave}>
      <p className="mb-4 text-sm text-text-secondary">
        Your yearly tuition budget. We use this to judge affordability — it never excludes an
        option outright unless a programme sets a hard ceiling.
      </p>

      <div className="grid gap-x-4 sm:grid-cols-3">
        <FormField label="Minimum" hint="Optional">
          <Input
            type="number"
            min="0"
            value={budgetMin}
            onChange={(e) => setBudgetMin(e.target.value)}
          />
        </FormField>
        <FormField label="Maximum per year">
          <Input
            type="number"
            min="1"
            value={budgetMax}
            onChange={(e) => setBudgetMax(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <Button type="submit" isLoading={isSaving} disabled={!budgetMax}>
        Save
      </Button>
    </form>
  );
}
