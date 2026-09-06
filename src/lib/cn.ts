import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard className composition helper used by every design-system component
// (docs/07-frontend-architecture.md §6) — merges conditional classes and resolves
// Tailwind conflicts (e.g. a caller overriding padding) predictably.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
