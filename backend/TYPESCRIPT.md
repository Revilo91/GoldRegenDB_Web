# Typisierung im Backend (Issues #141, #261)

Standard: **JSDoc + `// @ts-check`, Opt-in pro Datei.** Kein TypeScript-Build,
der Server startet weiterhin per `node src/index.js`. `tsc` prüft nur.

```bash
cd backend
npm run typecheck   # tsc --noEmit, läuft in CI (.github/workflows/tests.yml)
```

## Regeln

1. `tsconfig.json`: `allowJs: true`, `checkJs: false`, `strict: true`,
   `noEmit: true`. Geprüft werden genau die Dateien, die mit `// @ts-check`
   in der **ersten Zeile** beginnen (plus alle `.d.ts`).
2. Typen per JSDoc: `@param {Typ}`, `@returns`, `@typedef`, bei Bedarf
   `/** @type {X} */ (ausdruck)`-Casts. Beschreibungsprosa ist nicht nötig
   (siehe CLAUDE.md, Code-Konventionen).
3. Gemeinsame Typen liegen in `src/types/*.d.ts` und werden per
   `import('../types')` referenziert:
   - `db.d.ts`: Zeilentypen, so wie `pg` sie liefert (NUMERIC → `string`,
     TIMESTAMP/DATE → `Date`, JSONB → Objekt, BYTEA → `Buffer`)
   - `express.d.ts`: `req.user` (`AuthenticatedUser`)
   - `utils.d.ts`: geteilte Rückgabeformen von `passwordService` und
     `accountSecurity`
   Nur Typen, die eine Datei tatsächlich referenziert, gehören dorthin;
   ungenutzte Typen wieder entfernen.
4. Keine Logikänderung, um einen Typfehler zu beheben. Wo eine Korrektur das
   Laufzeitverhalten ändern würde, einen Cast setzen und den Punkt im PR
   erwähnen.
5. Neue Datei unter `@ts-check` nehmen: Pragma einfügen, `npm run typecheck`
   grün machen, Datei in `__tests__/tsCheckOptIn.test.js` eintragen. Der Test
   schlägt fehl, wenn ein Pragma verloren geht oder eine Datei mit Pragma nicht
   in der Liste steht.

## Stand

Unter `@ts-check`: `middleware/{auth,csrf,httpsRedirect,validate}.js` und
`utils/{accountSecurity,artikelBezeichnung,authCookie,constants,
encryptionService,fotoDateiname,passwordService,rabatt,whereClauseBuilder}.js`
(maßgeblich ist die Liste im Test).

Noch offen (jeweils eigener Schritt): `utils/{fotoService,fotoZip,
bestellungService,excelService,logger}.js`, `middleware/{cors,
securityHeaders}.js`, `schemas/*.js` (dort hilft `z.infer<typeof schema>`),
`config/db.js`, `routes/**` (hohe Änderungsfrequenz, zuletzt migrieren).

## Wann lohnt sich der Schritt zu echten `.ts`-Dateien + Build?

Solange `checkJs`/`@ts-check` reicht, um Regressionen abzufangen, lohnt sich
der Umstieg nicht – er kostet einen Build-Schritt, den dieses kleine Backend
heute nicht braucht (`node --watch src/index.js` im Dev, Docker-Image kopiert
`src/` unverändert). Sinnvoll wird ein echter `.ts`-Build erst, wenn:

- neuer Code mehrheitlich schon typsicher ist (die meisten Dateien unter
  `@ts-check`) und JSDoc-Kommentare selbst zur Last werden, oder
- Sprachfeatures gebraucht werden, die JSDoc nicht sauber ausdrücken kann
  (z. B. generische Utility-Typen, Decorators), oder
- ein Team-Beschluss fällt, dass neuer Code direkt als `.ts` geschrieben
  werden soll.

Migrationsschritte für diesen Fall (nicht Teil dieses Issues):

1. `tsconfig.json`: `noEmit: true` → `outDir: "dist"`, `rootDir: "src"`,
   `checkJs`/`allowJs` können bleiben (gemischte `.js`/`.ts`-Codebasis ist
   während der Migration normal).
2. Build-Script ergänzen: `"build": "tsc"`, `"start": "node dist/index.js"`.
3. **Dockerfile** anpassen: Build-Stage braucht jetzt `devDependencies`
   (aktuell installiert die `backend-deps`-Stage nur `--production`), Runtime-
   Stage kopiert `dist/` statt `src/`:
   ```dockerfile
   FROM node:20-alpine AS backend-builder
   WORKDIR /app
   COPY backend/package*.json ./
   RUN npm install            # inkl. devDependencies für tsc
   COPY backend/ ./
   RUN npm run build          # -> dist/

   FROM node:20-alpine AS backend-deps
   WORKDIR /app
   COPY backend/package*.json ./
   RUN npm install --production

   FROM node:20-alpine
   WORKDIR /app
   COPY --from=backend-deps /app/node_modules ./node_modules
   COPY --from=backend-builder /app/dist ./dist
   CMD ["node", "dist/index.js"]
   ```
4. `.github/workflows/tests.yml` um einen `npm run build`-Schritt ergänzen
   (schlägt fehl, bevor fehlerhafter Code gemergt wird).
5. Datei für Datei `.js` → `.ts` umbenennen (nicht in einem Rutsch), `require`
   → `import` erst dort, wo ohnehin migriert wird – CommonJS-Interop
   (`esModuleInterop`) bleibt so lange nötig, wie noch `.js`-Dateien per
   `require()` eingebunden werden.
6. `npm run import:fotos` & Co. (eigenständige Scripts unter `backend/scripts/`)
   separat migrieren oder bewusst als `.js` belassen – sie laufen nicht über
   den Server-Build.
