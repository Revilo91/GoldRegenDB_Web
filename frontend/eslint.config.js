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
      // Befund G19: 68 blockierende alert() im Projekt. Eine Regel ohne Linter
      // ist Dokumentationsschuld – deshalb hier, damit sie nicht zurueckkommen.
      // Bewusst nicht `no-alert`: die Regel deckt auch confirm() ab, und das
      // ist in den Loeschpfaden weiter in Gebrauch.
      'no-restricted-globals': ['error', {
        name: 'alert',
        message: 'Statt alert() den useToast()-Hook aus components/Toast.jsx benutzen.',
      }],
      // Inline-Styles sind verboten (CLAUDE.md, "Frontend-Styling"): Klassen in index.css.
      // Erlaubt bleiben nur CSS-Variablen für dynamische Werte: style={{ "--name": wert }}.
      'no-restricted-syntax': ['error',
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property:not([key.type='Literal'][key.value=/^--/])",
          message: 'Kein Inline-Style: Klasse in index.css anlegen. Nur CSS-Variablen erlaubt, z. B. style={{ "--balken-breite": `${x}%` }}.',
        },
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > SpreadElement",
          message: 'Kein Inline-Style: Spread ist nicht prüfbar. Klasse in index.css anlegen oder CSS-Variablen einzeln setzen.',
        },
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > :not(ObjectExpression)",
          message: 'Kein Inline-Style: style darf nur ein Objektliteral mit CSS-Variablen sein.',
        },
        {
          selector: "JSXAttribute[name.name='style'] > Literal",
          message: 'Kein Inline-Style: Klasse in index.css anlegen.',
        },
      ],
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
