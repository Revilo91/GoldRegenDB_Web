// ESLint 9 Flat Config (kein .eslintrc.json/.eslintignore mehr, siehe Issue #142).
// Bewusste Abweichung vom Issue-Text: eslint-config-airbnb-base unterstuetzt
// Flat Config nicht sauber, daher @eslint/js "recommended" + Node-Globals statt Airbnb.
// ESLint-Major-Version (9.x) folgt frontend/eslint.config.js fuer Konsistenz im Repo.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'src/assets/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-unused-vars': [
        'error',
        // Express-Error-Handler brauchen die volle (err, req, res, next)-Signatur auch
        // wenn ein Parameter ungenutzt ist; _-Praefix markiert absichtlich ungenutzte Args
        // (auch in catch-Blocken, z.B. `catch (_err)` wenn nur der Fallback-Pfad zaehlt).
        {
          argsIgnorePattern: '^(next|_)',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'max-len': ['warn', 120],
    },
  },
  {
    // logger.js kapselt console bewusst als einzige Ausgabe-Instanz der App.
    files: ['src/utils/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // CLI-Skripte (kein Express-Kontext): console.log ist hier die eigentliche
    // Nutzerausgabe, kein Debug-Leftover.
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
