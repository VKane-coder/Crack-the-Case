import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Agent isolation: the patient agent must never see examiner or rubric code.
  {
    files: ["src/server/agents/patient/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/examiner/**", "**/examiner"], message: "Patient agent must not import examiner code." },
            { group: ["**/assessment/**", "**/rubric*"], message: "Patient agent must not import rubric/assessment code." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
