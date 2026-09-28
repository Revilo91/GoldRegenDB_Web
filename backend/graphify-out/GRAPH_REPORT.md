# Graph Report - backend  (2026-09-27)

## Corpus Check
- 106 files · ~211,160 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1076 nodes · 1620 edges · 79 communities (73 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `57ae5e4c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]

## God Nodes (most connected - your core abstractions)
1. `WhereClauseBuilder` - 30 edges
2. `query()` - 20 edges
3. `initializeDatabase()` - 18 edges
4. `validate()` - 15 edges
5. `compilerOptions` - 13 edges
6. `scripts` - 11 edges
7. `toCII()` - 10 edges
8. `erstelleERechnung()` - 10 edges
9. `speichereFoto()` - 10 edges
10. `where()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `modell()` --calls--> `buildRechnungsModell()`  [EXTRACTED]
  __tests__/eRechnung.test.js → src/utils/eRechnung/modell.js
- `modell()` --calls--> `getVerkaeufer()`  [EXTRACTED]
  __tests__/eRechnung.test.js → src/utils/eRechnung/verkaeufer.js
- `sammleFotos()` --calls--> `analysiereDateiname()`  [EXTRACTED]
  scripts/sammle-fotos.js → src/utils/fotoDateiname.js
- `buildApp()` --calls--> `validate()`  [EXTRACTED]
  __tests__/validation.test.js → src/middleware/validate.js
- `gruppiereNachBasis()` --calls--> `analysiereDateiname()`  [EXTRACTED]
  scripts/import-fotos.js → src/utils/fotoDateiname.js

## Import Cycles
- None detected.

## Communities (79 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (41): { AsyncLocalStorage }, bcrypt, connect(), connectionString, ensureAppUsersTable(), ensureArtikelnummerGrossschreibung(), ensureAuditLogTable(), ensureAuditLogTamperProtection() (+33 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (41): { authenticate, JWT_SECRET }, db, express, { hashPassword, verifyPassword }, jwt, logger, {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordWithTokenSchema,
}, {
  MAX_FEHLVERSUCHE,
  SPERRDAUER_MINUTEN,
  RESET_TOKEN_GUELTIGKEIT_MINUTEN,
  istGesperrt,
  verbleibendeSperrminuten,
  naechsterFehlversuch,
  erzeugeResetToken,
  hashResetToken,
} (+33 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (35): db, express, logger, { preisNachAllenRabattenSql }, router, { where }, aktivBedingung, ausschussBedingung (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (26): BRAND_SVG_PATH, buildHintsHtml(), buildLabelMarkup(), buildPrintCss(), db, escapeHtml(), express, getPrintCssTemplate() (+18 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (34): app, auditLogRoutes, { authenticate, requireAdmin, requireBearbeiter }, authRoutes, bestelluebersichtRoutes, bestellungPublicRoutes, cookieParser, cors (+26 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (23): { backupImportSchema }, checkWiederAnlegen(), db, ermittleNichtValidierteChecks(), ermittleSchemaInfo(), { erstelleFotoZip, importiereFotoZip }, express, { FOTO_TABELLEN } (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (25): artikelnummer, bestehendesPasswort, bool(), ganzzahl(), idParam, {
  MIN_PASSWORT_LAENGE,
  MAX_PASSWORT_LAENGE,
}, neuesPasswort, pflichttext() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (25): API, Artikelnummer-Filter, Ausgabe-Methoden, Basis-Beispiel, Beispiele aus den Routes, Best Practices, Dashboard: Verkaufte Stücke, Generische Filter (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (22): db, express, FILTER_OPTION_FIELDS, FLAG_WERTE, { GRUNDMATERIAL, PRODUKTART }, HAT_FOTO_SQL, istLeer(), logger (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (23): dependencies, bcryptjs, cookie-parser, cors, dotenv, exceljs, express, express-rate-limit (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (20): A4, ASSETS, crypto, datumDe(), erstelleZugferdPdf(), euro(), fontkit, { formatIban } (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.15
Nodes (18): env(), formatIban(), getVerkaeufer(), addInventurSheet(), { artikelKategorie, artikelBezeichnung }, autoFitColumns(), DEFAULT_LOGO_PATH, ExcelJS (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (19): devDependencies, adm-zip, eslint, @eslint/js, globals, jest, supertest, @types/cookie-parser (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (16): configured, cors, corsMiddleware, DEFAULT_ORIGINS, logger, logger, buildEntry(), formatPretty() (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (17): { analysiereDateiname }, artikelnummernIn(), crypto, fs, listeDateien(), logger, main(), os (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (18): AppRole, AppUserRow, AuditActionType, AuditLogRow, BestellstatusTyp, BestellungConsentRow, BestellungFotoRow, BestellungKundeRow (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (15): erstelleERechnung(), ASSETS, fs, IBAN_REGELN, { ibanGueltig }, ladeStylesheet(), ladeXsd(), path (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (15): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (13): { artikelnummerBasis, artikelKategorie, artikelBezeichnung }, buildRechnungsModell(), cent(), ENV(), ibanGueltig(), leer(), prozentVon(), pruefePflichtangaben() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (12): { AUTH_COOKIE_NAME }, authenticate(), db, extractToken(), { getSecret }, jwt, JWT_SECRET, JWT_SECRET_OLD (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (14): { analysiereDateiname }, dotenv, fs, { getSecret }, GRUENDE, logger, logZeilen(), logZusammenfassung() (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (11): AdmZip, buildApp(), db, express, FOTO_TABELLEN, KATALOG_FKS, KATALOG_PKS, KATALOG_SPALTEN (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (13): { encryptField, decryptField, hashValue }, crypto, decryptKunde(), { encryptField, decryptField, hashValue }, formatBestellnummer(), generateKundePseudonym(), getNextBestellnummer(), insertBestellung() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (14): basisArtikelnummer(), FotoFehler, ARTEN, ENDUNG, importiereFotoZip(), leseEintrag(), {
  MAX_FOTO_BYTES,
  FotoFehler,
  basisArtikelnummer,
  speichereFoto,
  listeFotos,
  ladeFotoDaten,
}, naechsterEintrag() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (13): { bestellungBasisSchema, bestellungUpdateSchema }, db, { encryptField }, express, {
  getNextBestellnummer,
  toBestellungResponse,
  validateDatenminimierung,
  insertBestellung,
}, {
  leseDataUrl,
  neuerBestellungFotoName,
  speichereFoto,
  loescheFoto,
  sendeFoto,
}, logger, path (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (12): db, express, { FORMATE, erstelleERechnung, ERechnungFehler }, formatJahresNummer(), { generateExcel }, getNextRechnungsnummer(), logger, { rechnungSchema } (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (12): db, express, extractArtikelnummer(), logger, parseCSVLines(), { PRODUKTART }, router, { sumupImportSchema } (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.16
Nodes (12): alsBuffer(), {
  eintragsName,
  zerlegeEintragsName,
  erstelleFotoZip,
  importiereFotoZip,
}, fs, JPG, os, path, PNG, schreibeZip() (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.44
Nodes (12): attrs(), betrag(), datum102(), el(), esc(), grp(), indikator(), partei() (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.23
Nodes (8): buildTestApp(), cookieParser, express, bcrypt, buildApp(), { buildTestApp }, jwt, request

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (10): { bestellungPublicSchema }, db, express, { leseDataUrl, neuerBestellungFotoName, speichereFoto }, logger, router, { validate }, { validateDatenminimierung, insertBestellung } (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.17
Nodes (11): db, express, { hashPassword }, logger, router, {
  userCreateSchema,
  userUpdateSchema,
  resetPasswordSchema,
}, VALID_ROLES, { validate } (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (11): args, databaseUrl, dotenv, dryRun, findCandidates(), { getSecret }, main(), path (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.22
Nodes (8): pruefeKlammern(), buildApp(), db, express, inventurRoutes, { pruefeKlammern }, request, { requireBearbeiter }

### Community 35 - "Community 35"
Cohesion: 0.24
Nodes (9): createTxClientMock(), sqlVerlauf(), buildApp(), { createTxClientMock, sqlVerlauf }, db, express, lieferscheineRoutes, request (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.25
Nodes (10): { AUTH_COOKIE_NAME }, crypto, csrfCookieOptions(), csrfProtection(), csrfTokenHandler(), erzeugeToken(), GESCHUETZTE_METHODEN, logger (+2 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (8): logger, db, { debugUpdateSchema }, express, logger, router, { validate }, debugUpdateSchema

### Community 38 - "Community 38"
Cohesion: 0.18
Nodes (11): scripts, dev, dsgvo:retention, dsgvo:retention:dry, import:fotos, lint, lint:fix, sammle:fotos (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.20
Nodes (10): db, express, formatJahresNummer(), { generateExcel }, getNextLieferscheinnummer(), { lieferscheinSchema }, logger, router (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (9): importiereFotos(), GIF, JPEG, {
  MAX_FOTO_BYTES,
  FotoFehler,
  erkenneBildtyp,
  pruefeBild,
  basisArtikelnummer,
  leseDataUrl,
  speichereFoto,
  sendeFoto,
}, PNG, erkenneBildtyp(), leseDataUrl(), pruefeBild() (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.20
Nodes (10): beispielDaten(), { buildRechnungsModell, pruefePflichtangaben, ibanGueltig }, ENV_BACKUP, { erstelleERechnung, ERechnungFehler }, { getVerkaeufer }, { kundeSchema }, modell(), { PDFDocument, PDFName, decodePDFRawStream } (+2 more)

### Community 42 - "Community 42"
Cohesion: 0.20
Nodes (10): crypto, ersterEtag(), FOTO_TABELLEN, hatFotoSql(), ladeFotoDaten(), loescheFoto(), path, PNG_SIGNATUR (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (8): ERechnungFehler, { erstelleZugferdPdf }, FORMATE, { getVerkaeufer }, { PROFILE, buildRechnungsModell, pruefePflichtangaben }, { toCII }, { validiereCII }, PROFILE

### Community 44 - "Community 44"
Cohesion: 0.20
Nodes (9): db, express, { kundeSchema, restockSelectiveSchema }, logger, router, { validate }, { where }, kundeSchema (+1 more)

### Community 45 - "Community 45"
Cohesion: 0.20
Nodes (7): fs, { importiereFotos, logZeilen }, JPEG, { MAX_FOTO_BYTES }, os, path, PNG

### Community 46 - "Community 46"
Cohesion: 0.24
Nodes (7): app, { buildTestApp }, db, request, schmuckstueckeRoutes, GRUNDMATERIAL, PRODUKTART

### Community 47 - "Community 47"
Cohesion: 0.24
Nodes (8): { authenticate, requireAdmin }, buildApiDocsApp(), collectActualRoutes(), express, request, ROUTER_MOUNTS, swaggerSpec, toOpenApiStyle()

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (6): app, db, express, MAGIC, request, schmuckstueckeRoutes

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (7): requireBearbeiter(), buildApp(), db, express, kundenRoutes, request, { requireBearbeiter }

### Community 50 - "Community 50"
Cohesion: 0.25
Nodes (7): description, engines, node, npm, main, name, version

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (7): API-Dokumentation: Lager-Inventur-Entwürfe, Endpunkte, GET `/drafts`, GET `/drafts/:id`, POST `/drafts`, POST `/drafts/:id/complete`, PUT `/drafts/:id`

### Community 52 - "Community 52"
Cohesion: 0.25
Nodes (5): BEISPIELE, { erstelleERechnung }, fs, path, { PDFDocument, PDFName, decodePDFRawStream }

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (6): gruppiereNachBasis(), { analysiereDateiname }, analysiereDateiname(), { basisArtikelnummer }, ERLAUBTE_ENDUNGEN, path

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (7): buildApp(), db, express, FOTO, fs, path, request

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (6): bestelluebersichtRoutes, buildApp(), db, { encryptField }, express, request

### Community 56 - "Community 56"
Cohesion: 0.32
Nodes (7): { AUTH_COOKIE_NAME }, buildApp(), cookieParser, {
  CSRF_COOKIE_NAME,
  csrfProtection,
  csrfTokenHandler,
  erzeugeToken,
}, express, request, TOKEN

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (7): buildApp(), { createTxClientMock, sqlVerlauf }, db, express, rechnungenRoutes, request, { requireBearbeiter }

### Community 58 - "Community 58"
Cohesion: 0.29
Nodes (7): buildApp(), { createTxClientMock, sqlVerlauf }, db, express, request, { requireBearbeiter }, sumupRoutes

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (5): definition, path, swaggerJsdoc, swaggerSpec, { version }

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (4): buildApp(), express, httpsRedirect, request

### Community 61 - "Community 61"
Cohesion: 0.29
Nodes (7): jest, clearMocks, collectCoverageFrom, restoreMocks, testEnvironment, testMatch, testTimeout

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (5): bestellungPublicRoutes, buildApp(), db, express, request

### Community 63 - "Community 63"
Cohesion: 0.29
Nodes (6): FehlversuchErgebnis, JwtPayload, PasswortPruefErgebnis, ResetTokenErgebnis, SperrbarerUser, WhereClauseResult

### Community 64 - "Community 64"
Cohesion: 0.33
Nodes (3): requireAdmin(), { authenticate, requireAdmin, requireBearbeiter }, jwt

### Community 65 - "Community 65"
Cohesion: 0.33
Nodes (6): global, branches, functions, lines, statements, coverageThreshold

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (5): Einzige Quelle, Etikett-Größen, Layout, Neue Größe hinzufügen, Vorschau und Druck sind identisch

### Community 67 - "Community 67"
Cohesion: 0.33
Nodes (5): crypto, { getSecret }, KEY, KEY_HEX, logger

### Community 68 - "Community 68"
Cohesion: 0.40
Nodes (5): validate(), buildApp(), express, post(), request

### Community 69 - "Community 69"
Cohesion: 0.50
Nodes (3): buildApp(), express, request

### Community 70 - "Community 70"
Cohesion: 0.50
Nodes (3): buildApp(), express, request

### Community 71 - "Community 71"
Cohesion: 0.50
Nodes (4): buildApp(), express, mockQuery, request

### Community 72 - "Community 72"
Cohesion: 0.83
Nodes (3): build-erechnung-regeln.sh script, laden(), saxon()

## Knowledge Gaps
- **596 isolated node(s):** `{
  MAX_FEHLVERSUCHE,
  SPERRDAUER_MINUTEN,
  RESET_TOKEN_GUELTIGKEIT_MINUTEN,
  istGesperrt,
  verbleibendeSperrminuten,
  naechsterFehlversuch,
  erzeugeResetToken,
  hashResetToken,
}`, `JETZT`, `request`, `db`, `auditLogRoutes` (+591 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Community 13` to `Community 50`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `jest` connect `Community 61` to `Community 65`, `Community 50`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `WhereClauseBuilder` connect `Community 6` to `Community 2`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `{
  MAX_FEHLVERSUCHE,
  SPERRDAUER_MINUTEN,
  RESET_TOKEN_GUELTIGKEIT_MINUTEN,
  istGesperrt,
  verbleibendeSperrminuten,
  naechsterFehlversuch,
  erzeugeResetToken,
  hashResetToken,
}`, `JETZT`, `request` to the rest of the system?**
  _596 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07102040816326531 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06292517006802721 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06387921022067364 - nodes in this community are weakly interconnected._