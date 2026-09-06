import type { Config } from "tailwindcss";

// Design tokens per docs/07-frontend-architecture.md §7 (logo-derived palette,
// see docs/54-decision-log.md D-12 — Green -> Navy brand relationship).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0A2540", // SnZ Navy — matches the logo exactly
        secondary: "#3DA35D", // SnZ Green — approximation, see docs/55 B-4 (pending exact hex sampling)
        accent: "#635BFF", // Vibrant Indigo — tertiary, sparing use only (premium moments)
        bg: "#F8F9FA",
        surface: "#FFFFFF",
        "text-primary": "#1A1F36",
        "text-secondary": "#697386",
        success: "#3DA35D",
        warning: "#B7791F",
        error: "#C53030",
        info: "#3182CE",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "16px",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
    },
  },
  plugins: [],
};

export default config;
