import type { Config } from "tailwindcss";

// Design tokens per docs/07-frontend-architecture.md §7 (logo-derived palette,
// see docs/54-decision-log.md D-12 — Green -> Navy brand relationship).
//
// The palette is tiered deliberately: navy carries structure, green carries progress and
// affirmation, indigo appears only at premium moments. docs/07 §5 warns against using
// every brand colour at equal intensity, which is what makes a product look busy rather
// than considered.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0A2540", // SnZ Navy — matches the logo exactly
          50: "#F2F6FA",
          100: "#E1EAF3",
          200: "#C2D4E6",
          300: "#8FAEC9",
          400: "#5A81A6",
          500: "#2E5B85",
          600: "#164166",
          700: "#0A2540",
          800: "#071B2F",
          900: "#04101D",
        },
        secondary: {
          DEFAULT: "#3DA35D", // SnZ Green — see docs/55 B-4 (pending exact hex sampling)
          50: "#F1F9F3",
          100: "#DEF0E4",
          200: "#BCE1C9",
          300: "#8ECBA5",
          400: "#5FB47F",
          500: "#3DA35D",
          600: "#2F8449",
          700: "#26683A",
          800: "#1D4F2C",
          900: "#14371F",
        },
        accent: "#635BFF", // Vibrant Indigo — tertiary, premium moments only
        bg: "#F6F8FB",
        surface: "#FFFFFF",
        "surface-raised": "#FBFCFE",
        "text-primary": "#1A1F36",
        "text-secondary": "#697386",
        "text-muted": "#8C97A8",
        border: "#E3E8EF",
        success: "#2F8449",
        warning: "#B7791F",
        error: "#C53030",
        info: "#3182CE",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "16px",
        xl: "22px",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      backgroundImage: {
        // The one brand gradient, mirroring the logo's own green-to-navy diagonal.
        // Everything else is flat: docs/07 §6 rules out gradients on every button and card.
        "brand-gradient": "linear-gradient(135deg, #2F8449 0%, #0A2540 62%)",
        "brand-gradient-soft": "linear-gradient(135deg, #F1F9F3 0%, #F2F6FA 100%)",
        "brand-sheen": "linear-gradient(120deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 55%)",
      },
      boxShadow: {
        // Tinted with the brand navy rather than neutral black — a grey shadow on a
        // coloured surface is what makes an interface look cheap.
        sm: "0 1px 2px rgba(10, 37, 64, 0.06), 0 1px 3px rgba(10, 37, 64, 0.04)",
        md: "0 4px 12px rgba(10, 37, 64, 0.08), 0 2px 4px rgba(10, 37, 64, 0.04)",
        lg: "0 16px 32px rgba(10, 37, 64, 0.10), 0 4px 8px rgba(10, 37, 64, 0.05)",
        xl: "0 28px 56px rgba(10, 37, 64, 0.14), 0 8px 16px rgba(10, 37, 64, 0.06)",
        "brand-glow": "0 12px 32px rgba(47, 132, 73, 0.22)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // --- Marketing-site motion. These are ambient and looping, which is why they
        // live apart from the two product transitions above: the signed-in app never
        // uses them (docs/07 §"Motion"), the public site does.
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "float-x": {
          "0%, 100%": { transform: "translate(0, 0) rotate(-1deg)" },
          "50%": { transform: "translate(6px, -10px) rotate(1deg)" },
        },
        aurora: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(6%, -4%) scale(1.08)" },
          "66%": { transform: "translate(-4%, 6%) scale(0.96)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "scroll-cue": {
          "0%": { transform: "translateY(0)", opacity: "0" },
          "30%": { opacity: "1" },
          "100%": { transform: "translateY(10px)", opacity: "0" },
        },
      },
      animation: {
        // Short and purposeful — docs/07 §"Motion" caps ordinary transitions at ~300ms.
        "fade-up": "fade-up 320ms ease-out both",
        "fade-in": "fade-in 240ms ease-out both",
        float: "float 6s ease-in-out infinite",
        "float-slow": "float 9s ease-in-out infinite",
        "float-x": "float-x 8s ease-in-out infinite",
        aurora: "aurora 18s ease-in-out infinite",
        "aurora-slow": "aurora 26s ease-in-out infinite reverse",
        marquee: "marquee 38s linear infinite",
        "spin-slow": "spin-slow 60s linear infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.2, 0.6, 0.2, 1) infinite",
        shimmer: "shimmer 3.2s linear infinite",
        "gradient-x": "gradient-x 8s ease infinite",
        "scroll-cue": "scroll-cue 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
