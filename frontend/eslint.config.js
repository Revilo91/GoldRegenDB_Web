import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        // `const { ausgelagert, ...rest } = filters` entfernt einen Schlüssel aus
        // rest – die benannte Variable ist absichtlich unbenutzt. Ohne diese
        // Option meldete die Regel jedes solche Muster als Fehler (6 Fundstellen).
        ignoreRestSiblings: true,
        // `[_, count]` überspringt das erste Element einer Array-Destrukturierung.
        destructuredArrayIgnorePattern: '^_',
        // Bewusst ignorierte Parameter als `_name` schreiben dürfen.
        argsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Build-/Tooling-Konfiguration läuft in Node, nicht im Browser
    files: ['*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Vitest läuft mit `globals: true` (siehe vite.config.js), describe/it/
    // expect/vi sind dort also echte Globals. Ohne diese Deklaration meldete
    // ESLint sie als no-undef – das waren 104 der 155 Fehler, allesamt aus
    // dieser einen fehlenden Konfigurationszeile.
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
])
