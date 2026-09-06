import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // scripts/*.cjs are plain Node preload scripts loaded via NODE_OPTIONS before any
    // bundler/transpiler runs, so they must stay CommonJS — not part of the TS project.
    ignores: [".next/**", "node_modules/**", "prisma/generated/**", "scripts/**/*.cjs"],
  },
];

export default eslintConfig;
