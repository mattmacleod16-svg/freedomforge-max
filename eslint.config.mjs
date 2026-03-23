import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      react: {
        // Use explicit version to avoid eslint-plugin-react calling context.getFilename()
        // (removed in ESLint 10 flat config) during auto-detection.
        version: '19.2.4',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // New experimental React 19 hooks rules — too strict for existing patterns
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    // CommonJS modules and test files legitimately use require()
    files: ['scripts/**/*.js', 'lib/**/*.js', 'tests/**/*.js', 'mobile/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // TypeScript modules using optional-dependency require() pattern
    files: ['lib/**/*.ts', 'app/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    // Generated Capacitor web build output should not be linted as source.
    "ios/App/App/public/**",
  ]),
]);

export default eslintConfig;
