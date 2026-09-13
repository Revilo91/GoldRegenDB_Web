# TypeScript in diesem Backend (Issue #141)

Stand: JSDoc + `tsc --noEmit` als Typprüfung, **kein** Build-Schritt. Der
Server startet weiterhin unverändert per `node src/index.js` – `tsc` wird nur
lokal/in CI zur Prüfung aufgerufen, nie zum Kompilieren.

```bash
cd backend
npm run typecheck   # tsc --noEmit, prüft nur Dateien mit // @ts-check + alle .d.ts
```

## Warum JSDoc statt `.ts`-Dateien?

Eine vollständige `.js` → `.ts`-Migration würde den Laufzeit-Build umstellen
(Dockerfile, `npm start`, `node --watch`) und kollidiert mit paralleler Arbeit
an `backend/src/**`. Stattdessen:

1. **`tsconfig.json`** mit `allowJs: true`, `checkJs: false`, `noEmit: true`.
   Ohne `// @ts-check`-Pragma am Dateianfang wird eine `.js`-Datei von `tsc`
   zwar geparst (für den Modul-Graphen), aber **nicht** typgeprüft – der
   Rollout ist damit pro Datei steuerbar und für den Rest des Codes
   wirkungslos.
2. **`backend/src/types/`** enthält die eigentlichen Typdefinitionen
   (`.d.ts`, kein Code, keine Laufzeitwirkung):
   - `db.d.ts` – Zeilentypen aller Tabellen aus `db/init.sql`, so wie `pg`
     sie tatsächlich zurückgibt (siehe Kommentar am Dateianfang: NUMERIC →
     `string`, TIMESTAMP/DATE → `Date`, JSONB → geparstes Objekt, BYTEA →
     `Buffer`).
   - `express.d.ts` – erweitert `Request` um `req.user` (Payload aus
     `middleware/auth.js` / `jwt.sign(...)` in `routes/auth.js`).
   - `utils.d.ts` – Rückgabeformen von `passwordService`, `accountSecurity`,
     `whereClauseBuilder` u. a., die (noch) nicht selbst unter `@ts-check`
     stehen.
   - `index.d.ts` – Sammel-Export, z. B.
     `/** @typedef {import('../types').SchmuckstueckRow} SchmuckstueckRow */`.
3. **Pilot-Dateien** mit `// @ts-check` + JSDoc-Annotationen:
   - `src/utils/whereClauseBuilder.js`
   - `src/utils/constants.js`
   - `src/middleware/auth.js`

   Diese drei sind rein additiv typisiert – **keine Verhaltensänderung**
   (einzige Ausnahme: die Catch-Blöcke in `auth.js` prüfen `err instanceof
   Error`, weil TypeScript `catch`-Variablen strikt als `unknown` behandelt;
   für alle von `jwt.verify` tatsächlich geworfenen Fehler ist das Ergebnis
   identisch zu vorher).

## Weitere Dateien schrittweise unter `@ts-check` nehmen

1. Datei auswählen, die **stabil** ist (kein aktiver PR/Refactor gerade
   parallel) und wenig `require()`-Kopplung an noch ungetypten Code hat.
2. `// @ts-check` als erste Zeile einfügen, `npm run typecheck` laufen
   lassen.
3. Fehler beheben – **nur** durch JSDoc-Annotationen (`@param`, `@returns`,
   `@type`, `@typedef`, ggf. `/** @type {X} */ (ausdruck)`-Casts). Keine
   Logikänderung, auch keine Umbenennungen "nebenbei".
4. Für DB-Zeilen/`req.user`/gemeinsame Rückgabeformen die Typen aus
   `src/types/` importieren statt neue zu erfinden – Konsistenz mit den
   echten Spalten aus `db/init.sql` ist hier das Ziel, nicht Bequemlichkeit.
5. `npm test` grün halten, dann committen.

Gute nächste Kandidaten (stand jetzt unangetastet, geringe Kopplung):
`src/utils/accountSecurity.js`, `src/utils/passwordService.js`,
`src/utils/authCookie.js`, `src/utils/encryptionService.js`,
`src/middleware/validate.js`, `src/schemas/*.js` (dort ergänzt
`z.infer<typeof schema>` die Zod-Schemas fast ohne zusätzliche Typannotationen).

Absichtlich **nicht** angefasst in diesem Zug: `src/utils/logger.js` (parallel
in Bearbeitung), `src/index.js`, `src/routes/**` (hohe Änderungsfrequenz,
viele parallele Issues) – die Types in `src/types/db.d.ts` sind aber bereits
so geschnitten, dass die Routen sie beim Migrieren direkt verwenden können.

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
6. `npm run sync:fotos` & Co. (eigenständige Scripts unter `backend/scripts/`)
   separat migrieren oder bewusst als `.js` belassen – sie laufen nicht über
   den Server-Build.
