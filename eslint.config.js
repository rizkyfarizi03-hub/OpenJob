const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "openjob_api/.qa-postgres/**",
      "openjob_api/qa-postgres-files/**",
      "openjob_api/uploads/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Express mengenali error handler dari jumlah parameternya.
      "no-unused-vars": ["error", { argsIgnorePattern: "^next$" }],
    },
  },
  {
    files: ["openjob_web/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.browser },
  },
];
