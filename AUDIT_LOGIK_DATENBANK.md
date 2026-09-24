# GoldRegenDB_Web — Audit: Logik- und Datenbankfehler

## Umfang und Methode

Gegenstand sind **Logik- und Umsetzungsfehler sowie Datenbankprobleme** —
explizit **ohne Security-Themen** (kein Auth/JWT/CSRF/SQLi/Rate-Limiting/
Secrets). Am Ende stehen daraus abgeleitete Best Practices.

Grundlage ist das vollständige Lesen von Schema, Startup-Pfad, Routen,
Frontend, CI und Deployment-Konfiguration. Jeder Befund nennt `datei:zeile` und
ein konkretes Fehlerszenario. Befunde mit der Markierung *verifiziert* wurden
zusätzlich direkt im Code nachgelesen und bestätigt.

Dieses Dokument beschreibt den Stand zum Zeitpunkt des Audits (Commit `b06aaf7`)
und ändert selbst keinen Code. Teil 2 enthält einen nach Aufwand/Wirkung
sortierten Reparaturplan.

> Randnotiz: `CLAUDE.md` verlangt, vor jeder Projektfrage `/graphify` zu rufen.
> Das ist nicht erfüllbar — `graphify-out/` existiert nicht und steht in
> `.gitignore`. Für jeden frischen Clone ist die Regel toter Text (siehe E14).

---

## Die Kurzfassung

Das Projekt ist handwerklich **besser als der Durchschnitt**: zod-Validierung
mit deutschen Meldungen, Prepared Statements durchgängig, ein Audit-Log mit
Hash-Kette, ein zentraler `whereClauseBuilder`, 32 Backend-Testdateien, sinnvolle
Kommentare, die das *Warum* erklären. Keine leeren catch-Blöcke im Backend.

Die Probleme haben zwei durchgehende Muster:

**Muster 1: Wo ein Fehler auffallen müsste, wird er weggelogt statt gemeldet.**
Migrationen, Seed-Import, Backup-Rotation, Statusfelder, Foto-Index — jeder
dieser Pfade hat eine Variante von „Fehler passiert, System sagt OK".

**Muster 2: Dasselbe Problem ist zweimal gelöst — einmal richtig, einmal
falsch.** `UNIQUE ("ID")` auf `Lieferschein`, aber nicht auf `Rechnung`.
`BEGIN` in den POST-Routen, nicht in PUT/DELETE. `parseFloat(…) || 0` an einer
von sechs Stellen. Geschütztes `ROLLBACK` in drei Dateien, ungeschütztes in
einer. `TablePhoto` auf Modulebene in `Inventur.jsx`, im Render-Body in
`Schmuckstuecke.jsx`. Debounce + Abort in `Etiketten.jsx`, nichts davon in
`Schmuckstuecke.jsx`. Das ist kein Wissensproblem — die richtige Lösung steht
jeweils im gleichen Repo. Es fehlt der Mechanismus, der sie erzwingt.

Die vier teuersten Einzelbefunde:

1. **[S0]** `docker compose up` auf leerem Volume schlägt fehl — `seed.sql`
   schreibt in eine Spalte, die es nicht gibt (**A0**).
2. **[S1]** Geld liegt als `DOUBLE PRECISION` in der Datenbank (**B1**).
3. **[S1]** Der Produktions-Compose verliert beim Update alle Fotos (**E1**).
4. **[S1]** Rabatte fehlen in Dashboard, Excel-Summe **und**
   Auszahlungsaufteilung — drei Stellen, dieselbe Lücke (**C17**, **C18**,
   **G7**).

Legende: **[S0]** = System startet nicht · **[S1]** = Datenverlust oder stille
Falschdaten · **[S2]** = Fehlverhalten im Normalbetrieb · **[S3]** =
Umsetzungs-/Prozessfehler.

---

# A. Startup, Seed & Migrationen

### A0 [S0] Frische Installation schlägt fehl: `seed.sql` kennt eine Spalte `"Online"`, die nicht existiert — *verifiziert*
`db/seed.sql` nennt die Spalte `"Online"` in der Spaltenliste von **16**
mehrzeiligen `INSERT INTO "Schmuckstück"`-Statements:
```sql
INSERT INTO "Schmuckstück" (…, "Herstellungskosten", "Verkaufspreis", "Online",
                            "Ausgelagert", "Verkauft", …)
```
In `db/init.sql` und `backend/src/config/db.js` kommt `"Online"` **null Mal**
vor (`grep -c` = 0/0). Die Spalte stammt aus MySQL
(`GoldRegenDB_structure.sql:107`: `` `Online` tinyint(1) DEFAULT 0 ``) und wurde
bei der Postgres-Migration gestrichen — im Seed aber nicht.

> Zur Einordnung der Zahl: `grep -c '"Online"' db/seed.sql` liefert 653, das
> sind aber überwiegend `audit_log`-Zeilen, deren `new_value` einen
> JSON-Schnappschuss der ganzen Schmuckstück-Zeile enthält — dort ist
> `"Online"` nur ein Schlüssel **innerhalb eines Textwerts** und völlig
> harmlos. Problematisch sind ausschließlich die 16 Spaltenlisten.

`seed.sql` legt die Spalte auch nicht selbst an; die einzigen `ALTER TABLE`
darin sind `DISABLE/ENABLE TRIGGER ALL` (Zeile 11 und 12464).

Die Spalte wird im Anwendungscode **nirgends** gelesen oder geschrieben
(geprüft über `backend/src` und `frontend/src`). Die einzigen `Online`-Treffer
sind unbeteiligt: SumUp-CSV-Spaltenköpfe (`sumup.js:454-475`) und der String
`'Online-Formular'` (`bestellungPublic.js:132`).

Bemerkenswert dabei: der SumUp-Export schreibt „Display item in Online Store?"
fest auf `"Yes"` (`sumup.js:515`, `:554`) — genau das, was das alte
`Online`-Flag einmal gesteuert haben dürfte. In den Daten stehen **188** Stücke
mit `Online = 1` und 7402 mit `0`; die Spalte ist also nicht leer, sondern
trägt echte Information.

*Fehlerszenario:* `docker compose up` auf leerem Volume. Der offizielle
`postgres`-Entrypoint führt `/docker-entrypoint-initdb.d/*.sql` mit
`ON_ERROR_STOP=1` aus. `02-seed.sql` bricht bei
`column "Online" of relation "Schmuckstück" does not exist` ab, und weil
`seed.sql:5` ein `BEGIN;` öffnet, rollt der **gesamte** Seed zurück. Ergebnis:
leeres Schema, fehlgeschlagene Container-Initialisierung.

*Lösung:* Zwei Wege wären möglich — `"Online" BOOLEAN NOT NULL DEFAULT FALSE`
in `init.sql` + `db.js` nachziehen, oder die Spalte aus `seed.sql` entfernen.
**Entschieden wurde das Entfernen**, weil der Anwendungscode die Spalte nicht
nutzt; die 188 Artikelnummern mit `Online = 1` werden vorher nach
`db/online_flag_2026-09.csv` gesichert, damit die Information nicht
unwiederbringlich verloren geht.

Dauerhaft: die Generatoren (`db/json_to_sql.py`,
`db/convert_mysql_to_pg.py`) gegen `information_schema.columns` abgleichen,
statt die Spaltenliste blind aus der Quelle zu übernehmen.

### A1 [S1] Migrationen laufen als „floating promise", der Server wartet nicht — *verifiziert*
`backend/src/config/db.js:888` startet die Migrationskette beim Modul-Load,
ohne `await`:
```js
pool.query('SELECT NOW() AS server_time')
  .then(() => ensureTriggerFunctions().then(() => ensureKundeTable()) … )
  .catch((err) => { logger.error('DB', 'Verbindung … fehlgeschlagen', …); });
```
`backend/src/index.js:27` macht nur `require('./config/db')`, und
`index.js:240` ruft `app.listen()` synchron. Der Server nimmt Requests an,
während das Schema noch migriert wird.

*Fehlerszenario:* Nach einem Update, das eine Spalte ergänzt (z. B.
`rabatt_gesamt`, `db.js:308`), treffen die ersten Requests ein Schema ohne
diese Spalte → `column "rabatt_gesamt" does not exist`, HTTP 500, verschwindet
nach Reload, nicht reproduzierbar.

### A2 [S1] Jede Migration schluckt ihren eigenen Fehler — *verifiziert*
Alle elf `ensureXTable()`-Funktionen enden in
`catch (err) { logger.error(…) }` und kehren **normal zurück** —
`db.js:206`, `232`, `266`, `327`, `386`, `409`, `536`, `613`, `635`, `795`,
`826`, `866`.

*Fehlerszenario:* `ALTER TABLE "Rechnung" ADD COLUMN rabatt_gesamt` scheitert →
eine Logzeile zwischen hunderten, Server startet, **jede** Rechnungsabfrage
wirft ab jetzt `column does not exist`. Für alle Nutzer, dauerhaft.

Verschärfend: `db.js:874-886` dokumentiert die FK-Abhängigkeitsreihenfolge.
Scheitert Schritt 2 (`Kunde`), scheitern 3–5 (`Lieferschein`, `Rechnung`,
`Schmuckstück`) zwangsläufig nach — jeder still.

### A3 [S1] `/api/health` lügt — *verifiziert*
`index.js:167-175` prüft nur `SELECT 1` und meldet dann
`{status:'ok', database:'connected'}`. Während laufender oder gescheiterter
Migrationen ist der Health-Check grün. `docker-compose.yml` hat für den
`app`-Service ohnehin **keinen** Healthcheck (nur `db` hat einen).

### A4 [S2] Verdrehte Abbruch-Prioritäten
`index.js:21` beendet den Prozess mit `process.exit(1)`, wenn ein Secret zu
kurz ist. Ein **komplett fehlgeschlagenes Schema** ist nur eine Logzeile (A2).
Die harte Abbruchbedingung sitzt an der falschen Stelle.

### A5 [S2] Kein Migrations-Versionsstand, Schema an zwei Orten, bereits auseinandergelaufen
Das Schema existiert doppelt: `db/init.sql` (läuft **nur** beim ersten Anlegen
des Volumes) und die `ensureX`-Funktionen in `db.js`. Keine
`schema_migrations`-Tabelle, keine Versionsnummern, keine Transaktion um die
Kette, kein Rollback — obwohl Postgres transaktionales DDL beherrscht und
Rollback damit gratis wäre.

Die Drift ist eingetreten:
- `rabatt_gesamt NUMERIC(5,2)` und `rabatt_positionen JSONB` (`db.js:308`,
  `:321`) fehlen in `init.sql`.
- Der CHECK `schmuckstueck_ausschuss_grund_required_chk` (`db.js:802-829`)
  fehlt in `init.sql`.
- `previous_hash`/`hash` sind in `init.sql:256-257` inline, in `db.js:396-406`
  nicht — dort per `:422-426` nachgerüstet.

Wer `init.sql` liest, liest ein Schema, das nie existiert.

**Parallelstart ist scharf:** Die Kette läuft bei jedem Boot ohne Advisory
Lock. `db.js:585-598` macht bei **jedem** Start ein Drop-and-Recreate:
```sql
IF EXISTS (… conname = 'app_users_role_check') THEN
  ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;
END IF;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (…);
```
Zwei parallel startende Container (Replicas, oder `restart: always` im
Crashloop): A dropt, B dropt ins Leere, A fügt hinzu, B bekommt
`42710 constraint already exists` — geschluckt von `catch`. Im Fenster zwischen
DROP und ADD ist `app_users.role` unvalidiert.

Zusätzlich fehlt in `db.js:257`, `:292`, `:305`, `:318`, `:568` und
`backup.js:726-729` überall `AND table_schema = 'public'` — nach einem Restore
in ein temporäres Schema liefert `EXISTS` ein falsches Positiv und die
Migration wird stillschweigend übersprungen.

### A6 [S2] Ein Idle-Client-Fehler killt das Backend — *verifiziert*
`db.js:138-141`:
```js
pool.on('error', (err) => { logger.error(…); process.exit(-1); });
```
Ein DB-Restart, ein Netzwerk-Blip oder ein Spin-Down der Synology-Platte
beendet den gesamten Prozess (Exit-Code 255). Es gibt **keinen**
`SIGTERM`-Handler und kein `pool.end()` — `docker stop` reißt laufende
Requests ebenfalls ab.

### A7 [S1] `load_seed.sh` meldet Erfolg, auch wenn der Import komplett scheitert — *verifiziert*
`db/load_seed.sh:23-31`:
```bash
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /docker-entrypoint-initdb.d/02-seed.sql
…
echo "✅ Seed-Daten erfolgreich geladen"
```
Kein `-v ON_ERROR_STOP=1`. `psql` beendet sich mit Exit 0, auch wenn einzelne
Statements scheitern — `set -e` (Zeile 2) greift also nie. `db/restore.sh:60`
macht es richtig; `load_seed.sh` ist der Ausreißer.

*Fehlerszenario:* Genau A0. Das Skript truncatet erst alles
(`load_seed.sh:8-15`), der Seed scheitert am `"Online"`, und das Skript druckt
„✅ Seed-Daten erfolgreich geladen" plus eine Statistik mit lauter Nullen.

Nebenbefund: Die TRUNCATE-Liste in `load_seed.sh:8-15` nennt `Kunde`,
`Lieferschein`, `Rechnung`, `Schmuckstück`, `audit_log` — aber nicht
`app_users`, `lagerinventur`, `bestellung*`. `seed.sql:7` truncatet dagegen
**doch** `app_users` und legt einen Admin mit anderem bcrypt-Hash an
(`seed.sql:15`) als `init.sql:287-289`. Das in `init.sql:286` dokumentierte
Standardpasswort gilt nach dem Seed nicht mehr.

---

# B. Datenmodell & Datenbank

### B1 [S1] Geld als Gleitkommazahl — *verifiziert*
`db/init.sql:224-225`:
```sql
"Herstellungskosten" DOUBLE PRECISION DEFAULT 0,
"Verkaufspreis"      DOUBLE PRECISION DEFAULT 0,
```
`19.99` ist binär nicht exakt darstellbar. 37 Positionen à 19,99 € ergeben
`739.6299999999999`. Die Aggregate casten sogar explizit **zurück** nach double
(`dashboard.js:124-125`: `SUM("Verkaufspreis") … ::DOUBLE PRECISION`). Excel
zeigt per `numFmt` gerundet, die API liefert den Rohwert — beide weichen ab.
Provisionsketten (`total * (p/100)`, `excelService.js:571`) akkumulieren den
Fehler ungerundet bis zum Überweisungsbetrag.

Bemerkenswert: `rabatt_gesamt` ist bereits korrekt `NUMERIC(5,2)`
(`db.js:308`). In **einer** Rechnungsberechnung treffen also exaktes Dezimal
und Float aufeinander.

*Lösung:*
```sql
ALTER TABLE "Schmuckstück"
  ALTER COLUMN "Verkaufspreis" TYPE numeric(10,2) USING round("Verkaufspreis"::numeric, 2);
```
analog `Herstellungskosten`, plus `NOT NULL DEFAULT 0` und
`CHECK ("Verkaufspreis" >= 0)`. `pg` liefert `numeric` dann als String — das
ist gewollt, `Number()` erst an der Anzeigekante. Die `::DOUBLE PRECISION`-Casts
in `dashboard.js` entfernen.

### B2 [S1] Die Sentinel-Null ist keine: es gibt einen echten `Kunde` mit `ID = 0` — *verifiziert*
`db/init.sql:226`: `"Ausgelagert" INTEGER DEFAULT 0` — die Spalte trägt zwei
Bedeutungen gleichzeitig: `0` = „im Lager", `> 0` = Kunden-ID.

Und `db/seed.sql:4387`:
```sql
(0, 'Lager', 'Herzogin-Ludmilla-Ring', 5, 'Langquaid', 84085, …, 0, TRUE),
```
Es existiert ein **Kunde mit `ID = 0`** namens „Lager". `Ausgelagert = 0`
bedeutet damit zugleich „nicht ausgelagert" **und** „ausgelagert an Kunde 0".
Die Zählungen in `dashboard.js:118-122` (`inStockPieces` vs.
`outsourcedPieces`) und `inventur.js:49-53` sind systematisch inkonsistent, je
nachdem welche Query welchen Zweig nimmt. Und ein echter FK auf `Kunde("ID")`
kann nie validieren, ohne diesen Phantom-Kunden dauerhaft mitzuschleppen.

Dasselbe Muster bei `"Lieferschein_ID" INTEGER DEFAULT 0` und
`"Rechnung_ID" INTEGER DEFAULT 0` (`init.sql:230-231`) — `0` statt `NULL` ist
der Grund, warum `whereClauseBuilder.js:126`/`:134` `= 0` statt `IS NULL`
prüfen müssen.

*Lösung:* `NULL` ist in Postgres das Sentinel für „kein Bezug".
```sql
ALTER TABLE "Schmuckstück" RENAME COLUMN "Ausgelagert" TO "Ausgelagert_Kunde_ID";
UPDATE "Schmuckstück" SET "Ausgelagert_Kunde_ID" = NULL WHERE "Ausgelagert_Kunde_ID" = 0;
ALTER TABLE "Schmuckstück" ALTER COLUMN "Ausgelagert_Kunde_ID" DROP DEFAULT;
```
„Lager" (ID 0) und „Messe" (ID 7) als das modellieren, was sie sind: interne
Lagerorte, nicht Kunden.

### B3 [S1] Drei Fremdschlüssel sind bei der MySQL→PG-Migration verloren gegangen
`GoldRegenDB_structure.sql:194-197` hatte sie noch:
```sql
ALTER TABLE `Schmuckstück`
  ADD CONSTRAINT FOREIGN KEY (`Ausgelagert`)     REFERENCES `Kunde` (`ID`),
  ADD CONSTRAINT FOREIGN KEY (`Lieferschein_ID`) REFERENCES `Lieferschein` (`ID`),
  ADD CONSTRAINT FOREIGN KEY (`Rechnung_ID`)     REFERENCES `Rechnung` (`ID`);
```
In `init.sql:199-243` und `db.js:337-384` existiert **kein einziger** davon —
nur die nackten Indizes. Und `grep "ON DELETE\|ON UPDATE"` über `init.sql` +
`db.js` liefert **null Treffer**: keine FK im ganzen Projekt hat ein
ON-DELETE-Verhalten.

*Fehlerszenario (Kunde löschen):* `kunden.js:330-334` macht ausschließlich
`DELETE FROM "Kunde" WHERE "ID" = $1` — kein Reset von `Ausgelagert`. Hat der
Kunde nur ausgelagerte Artikel, **gelingt** das Löschen. Alle Zeilen behalten
`Ausgelagert = <tote ID>` und sind danach dauerhaft unsichtbar: nicht
„verfügbar" (`whereClauseBuilder.js:54` fordert `= 0`), und in keiner
Kundenliste, weil `JOIN "Kunde" k ON s."Ausgelagert" = k."ID"`
(`dashboard.js:164`, `:228`, `inventur.js:55`) sie wegjoint. Der Lagerwert
sinkt still.

Hat der Kunde einen Lieferschein, greift `Lieferschein_ibfk_1` mit `NO ACTION`,
wirft 23503 — und der Handler antwortet mit generischem HTTP 500 („Fehler beim
Löschen des Kunden"), der Nutzer erfährt den Grund nie.

*Lösung:* Nach B2 die Spalten auf nullable FK umstellen, dann
`ON DELETE SET NULL` für Kunde/Lieferschein und `ON DELETE RESTRICT` für
Rechnung (Buchhaltungsbelege dürfen nicht durch einen Kunden-Delete
verschwinden). Waisen vorher per `NOT VALID` + `VALIDATE CONSTRAINT`
aufräumen.

### B4 [S1] `Rechnung."ID"` ist nicht UNIQUE — obwohl halb das Schema darauf zeigt — *verifiziert*
`db/init.sql:186-196`:
```sql
CREATE TABLE "Rechnung" (
    "ID" SERIAL,
    …
    PRIMARY KEY ("Nummer")            -- kein UNIQUE ("ID")!
);
CREATE INDEX idx_rechnung_id ON "Rechnung" ("ID");   -- nur ein *nicht*-eindeutiger Index
```
`"Lieferschein"` hat sein `UNIQUE ("ID")` (`init.sql:182`), `"Rechnung"` nicht.
Die Asymmetrie ist 1:1 aus MySQL übernommen
(`GoldRegenDB_structure.sql:133` `ADD UNIQUE KEY` vs. `:141` `ADD KEY`) — ein
alter Bug, treu mitmigriert.

*Fehlerszenario:* Jeder Pfad mit explizitem `"ID"` kann duplizieren —
`backup.js:775-780` (JSON-Import), `db/seed.sql`. Nach einem Doppel-Import
gibt es zwei Rechnungen mit `ID = 42`;
`SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = 42` (`rechnungen.js:140`)
mischt die Positionen beider, und der Excel-Export gibt eine falsche Rechnung
aus.

*Lösung:* `ALTER TABLE "Rechnung" ADD CONSTRAINT rechnung_id_key UNIQUE ("ID");`
und `DROP INDEX idx_rechnung_id` (der Constraint liefert den Index mit).

### B5 [S1] Primärschlüssel auf veränderlichen Fachdaten
- `init.sql:171-172` — `"Kunde"`: `PRIMARY KEY ("Name")`, `UNIQUE ("ID")`. Der
  PK ist der **Kundenname**, obwohl die Anwendung Kunden ausschließlich über
  `"ID"` identifiziert (alle Routen `/kunden/:id`, alle FKs, alle Joins). Zwei
  Kunden dürfen nicht gleich heißen, und eine Umfirmierung ändert den PK.
- `init.sql:181`/`192` — `PRIMARY KEY ("Nummer")` auf `Lieferschein`/`Rechnung`,
  und `lieferscheine.js:350` erlaubt ausdrücklich
  `UPDATE "Lieferschein" SET "Nummer" = $1` — ein PK-Update.
- `init.sql:234` — `"Schmuckstück"`: `PRIMARY KEY ("Artikelnummer")`, ein
  **sprechender** Schlüssel, aus dem per `SUBSTRING` Fachbedeutung extrahiert
  wird (siehe B10/C4).

*Lösung:* `"ID"` zum PK, die Fachnummer zu `UNIQUE`. Der Zustand „PK auf der
Fachnummer, FK-Ziel auf einer nicht-eindeutigen Spalte" ist genau verkehrt herum.

### B6 [S2] Statusfelder als `SMALLINT`, nullable, ohne CHECK
`init.sql:227-228`: `"Verkauft" SMALLINT DEFAULT 0`,
`"Ausschuss" SMALLINT DEFAULT 0`. `whereClauseBuilder.js:30`/`:41` fragt hart
`= 1` bzw. `= 0`.

*Fehlerszenario:* `Verkauft = 2` oder `Verkauft = NULL` ist erlaubt. Eine
solche Zeile ist in **keinem** Filter enthalten — nicht „verkauft" (`= 1`),
nicht „verfügbar" (`= 0`, und `NULL = 0` ist `UNKNOWN`). Der Artikel
verschwindet lautlos aus allen Listen, bleibt aber in `totalPieces` → Summe
der Statuszahlen ≠ Gesamtzahl.

Ebenso fehlt ein CHECK auf **gültige Kombinationen**:
`Verkauft=1 AND Ausschuss=1 AND Ausgelagert>0` ist darstellbar und
bedeutungslos. Die Statuslogik aus `CLAUDE.md` existiert nur als Konvention im
JS-Code, nicht als Datenbankregel.

Kontrast: `Kunde."Aktiv"` (`init.sql:170`) ist korrekt
`BOOLEAN NOT NULL DEFAULT FALSE`, `app_users.active` ebenfalls — die Migration
hat genau ein Feld richtig gemacht. Drei Schreibweisen für denselben Datentyp
im gleichen Schema.

*Lösung:*
```sql
ALTER TABLE "Schmuckstück"
  ALTER COLUMN "Verkauft" TYPE boolean USING ("Verkauft" <> 0),
  ALTER COLUMN "Verkauft" SET NOT NULL, ALTER COLUMN "Verkauft" SET DEFAULT false;
ALTER TABLE "Schmuckstück" ADD CONSTRAINT schmuck_status_chk
  CHECK (NOT ("Verkauft" AND "Ausschuss"));
```

### B7 [S2] Kein CHECK auf `status`, und DDL-Default ≠ API-Default
`init.sql:180`/`191`: `status VARCHAR(20) NOT NULL DEFAULT 'final'`. Erlaubt
sind laut `schemas/index.js:111` nur `'entwurf'|'final'` — aber nur in zod,
nicht in der DB.

*Fehlerszenario:* Ein Tippfehler auf einem Pfad ohne Validierung (Import,
psql, `backup.js`) erzeugt einen Status, den `lieferscheine.js:267`
(`if (status === 'final')`) nie trifft: der Lieferschein existiert, setzt aber
`Ausgelagert` nicht → Artikel gelten als im Lager, liegen aber beim Kunden.

Zusätzlich: DDL-Default ist `'final'`, API-Default ist `'entwurf'`
(`rechnungen.js:276`) — ein direkter INSERT ohne `status` erzeugt eine
**finale** Rechnung.

*Lösung:* `CHECK (status IN ('entwurf','final'))` oder ein `ENUM`-Typ wie
`bestellstatus_typ` (`init.sql:348`) — der Rest des Schemas macht es dort schon
richtig, nur diese zwei Tabellen nicht.

### B8 [S2] `Hausnummer`, `PLZ` und `Provision` als `INTEGER` — mit Beweis im Seed
`init.sql:164`, `166`, `169`:
```sql
"Hausnummer" INTEGER NOT NULL,
"PLZ"        INTEGER NOT NULL,
"Provision"  INTEGER NOT NULL DEFAULT 0,
```
- Hausnummern wie `12a`, `7-9`, `104 1/2` sind **nicht speicherbar**.
- PLZ verliert die führende Null: Dresden `01067` wird `1067` und druckt auf
  dem Lieferschein falsch. Kein Auslandsformat (`CH-8001`, `1234 AB`).
- Provision: 12,5 % nicht abbildbar, Einheit nirgends festgelegt, kein
  `CHECK (0..100)`.

**Der Beweis, dass das im Betrieb weh tut** — das Ausweichverhalten steht in
den Daten und im Code:
- `seed.sql:4390`: `(7, 'Messe', '-', 0, '-', 0, …)` — Platzhalter-Müll,
  weil `NOT NULL INTEGER` keine Leerwerte erlaubt.
- `sumup.js:201-203` legt genau so einen Kunden neu an:
  `VALUES ('Messe', '', 0, '', 0, 0, true)`.
- `seed.sql:4387` hat im **Email**-Feld des Lager-Kunden einen Zeitstempel:
  `'2025-10-07 15:14:05.646999@example.com'` — offenbar Rückstand eines
  Anonymisierungs-/Migrationsskripts.

*Lösung:* `text`/`varchar(10)` mit `CHECK (plz ~ '^[0-9]{5}$')`,
`numeric(5,2) CHECK BETWEEN 0 AND 100` für Provision, und `NULL` erlauben, wo
die Adresse fachlich optional ist.

### B9 [S2] `0` als „unbekannt" bei Maßen
`init.sql:205`, `215`, `221`: `"Länge"`, `"Anhänger_Grösse"`, `"Grösse"` je
`DOUBLE PRECISION DEFAULT 0`. `0` ist keine fehlende Angabe, sondern eine
gültige Zahl → jeder `AVG()`/`MIN()` darüber ist falsch. Korrekt: `NULL`.

### B10 [S2] Nicht normalisierte Wiederholgruppe, Enums als Freitext
`init.sql:206-219`: Der Block `Fassung / Form / Farbe / Inhalt_Material /
Inhalt_Farbe / Inhalt_Farbakzent / Inhalt_Zusatzmaterial` existiert
**zweimal** — einmal für das Stück, einmal als `Anhänger_*`. Ein zweiter
Anhänger bräuchte acht neue Spalten. 24 von 34 Spalten sind
Ausstattungsmerkmale.

Nebenbei die Namens-Inkonsistenz: `Inhalt_Farbakzent` (Singular) vs.
`Anhänger_Inhalt_Farbakzente` (Plural) — jede Query muss beide kennen.

Alle Merkmale sind `TEXT DEFAULT NULL`, also freie Enums: `'Silber'`,
`'silber'` und `'Silber '` sind drei Materialien. Sichtbar daran, dass
`schmuckstuecke.js:910-911` die zulässigen Werte per `array_agg(DISTINCT …)`
aus den **Bestandsdaten rekonstruieren** muss, statt sie aus einer
Referenztabelle zu lesen.

Dazu ist die Artikelnummer ein sprechender Schlüssel: Stelle 1 = Hersteller,
2 = Grundmaterial, 3 = Produktart (`whereClauseBuilder.js:174`, `:185`,
`:196`), plus `LEFT("Artikelnummer",1) IN ('M','S')` in `dashboard.js:176-180`.
Diese drei Attribute sind dreifach implizit gespeichert und nirgends validiert.
`ORDER BY length("Artikelnummer"), "Artikelnummer"` (14 Fundstellen) ist der
Workaround dafür, dass die Laufnummer im String steckt.

### B11 [S2] Fehlende und falsch sortierte Indizes
- **Ausdrucksfilter ohne Index:** `hersteller()`, `grundmaterial()`,
  `produktart()` filtern mit `SUBSTRING("Artikelnummer", n, 1) = $1`. Für
  **keine** der drei existiert ein Ausdrucksindex → jeder Hersteller-/
  Material-/Produktartfilter ist ein Sequential Scan.
  `idx_schmuck_artikelnummer_sort ON (length(…), "Artikelnummer")`
  (`init.sql:241`) hilft dabei nicht.
- **`LIKE` ohne `text_pattern_ops`:** `artikelnummerLike()`
  (`whereClauseBuilder.js:152`). Ein B-Tree auf `VARCHAR` mit nicht-C-Collation
  kann `LIKE 'M%'` nicht bedienen. Auch das ein Seq Scan.
- **`audit_log` hat außer dem PK keinen einzigen Index** (verifiziert über
  `init.sql` + `db.js`), bei 4.339 Zeilen im Seed und unbegrenztem Wachstum.
  Abgefragt wird sie als `ORDER BY change_timestamp DESC LIMIT 10` bei
  **jedem** Dashboard-Aufruf (`dashboard.js:139-143`), als
  `ORDER BY change_timestamp DESC LIMIT/OFFSET` plus `COUNT(*)` pro Seite
  (`auditLog.js:58`, `:62`), als `ILIKE '%…%'` über **sechs** Spalten
  gleichzeitig (`auditLog.js:51`) und als `WHERE artikelnummer_id = $1`
  (`auditLog.js:139`).
  → `CREATE INDEX idx_audit_ts ON audit_log (change_timestamp DESC);` und
  `idx_audit_artikel ON audit_log (artikelnummer_id, change_timestamp DESC);`
  Für die Freitextsuche `pg_trgm` + GIN. Gegen das Wachstum:
  `PARTITION BY RANGE (change_timestamp)` monatlich, alte Partitionen
  **detachen** — das ist auch die einzige Variante, die mit dem
  Immutable-Trigger verträglich ist.
- **`Lieferschein` hat null Indizes** (`init.sql:175-184`), obwohl `Rechnung`
  einen auf `Kundennummer` hat (`:197`) und MySQL ihn für beide hatte. Jeder
  `DELETE FROM "Kunde"` muss `Lieferschein` komplett scannen.
- **`Datum`-Spalten ohne Index**, obwohl `ORDER BY "Datum" DESC` die
  Default-Sortierung beider Listen ist (`lieferscheine.js:61`,
  `rechnungen.js:61`).
- **`idx_schmuck_status ("Verkauft","Ausschuss","Ausgelagert")`**
  (`init.sql:243`) hat die führende Spalte mit nur zwei distinkten Werten. Für
  den häufigsten Filter wäre ein partieller Index besser:
  ```sql
  CREATE INDEX idx_schmuck_verfuegbar ON "Schmuckstück" (length("Artikelnummer"), "Artikelnummer")
    WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0;
  ```
  Für `aktivAusgelagert(kundeId)` passt `("Ausgelagert","Verkauft","Ausschuss")`
  — genau die umgekehrte Reihenfolge des vorhandenen Index.

### B12 [S2] Audit-Trigger: ein globales Lock serialisiert jeden Bulk-Update
`init.sql:19-60` protokolliert sechs Spalten mit je einem **separaten** INSERT
pro geänderter Spalte, `AFTER UPDATE FOR EACH ROW`. Jeder dieser INSERTs löst
`audit_log_hash_chain()` aus (`init.sql:68-84`), die mit
```sql
PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
```
beginnt — gehalten bis **Transaktionsende**, nicht bis Statement-Ende.

*Fehlerszenario:* `lieferscheine.js:269` setzt für 200 Artikel in einem
Statement `Lieferschein_ID` **und** `Ausgelagert` → 400 Audit-Zeilen, 400
SHA-256-Berechnungen, alles unter einem globalen Lock. Solange diese
Transaktion läuft, blockiert **jeder** andere Request, der irgendein
Schmuckstück ändert — inklusive eines einzelnen Klicks auf „verkauft" in einem
anderen Tab. Mit `DB_POOL_MAX = 25` und einem Client pro Request (B14) legt
ein langer Import die Anwendung praktisch still.

Weitere Lücken desselben Triggers:
- Nur `TG_OP = 'UPDATE'`. **`INSERT` und `DELETE` werden nicht protokolliert** —
  `schmuckstuecke.js:1431` löscht einen Artikel spurlos, und seine Historie
  bleibt als Waise mit einer `artikelnummer_id` zurück, zu der es kein Objekt
  gibt.
- `trg_update_letzte_aenderung` (`init.sql:311-314`) setzt
  `Letzte_Änderung` bei **jedem** UPDATE, auch bei einem, der nichts ändert →
  Row-Version, WAL-Write und Index-Update ohne Anlass (Bloat). Gegenmittel:
  `WHEN (OLD.* IS DISTINCT FROM NEW.*)`.
- **`TRUNCATE` umgeht den Tamper-Schutz:** `trg_audit_log_immutable`
  (`init.sql:331-334`) deckt nur `UPDATE OR DELETE` ab. `load_seed.sh:8-15`,
  `seed.sql:7` und `backup.js:719-721` leeren `audit_log` damit legal — der
  Schutz greift für die eine Operation nicht, die alles löscht.
- `backfill_audit_chain()` (`init.sql:101-120`) läuft bei **jedem** Start
  (`db.js:510`) mit `WHERE hash IS NULL ORDER BY id` — kein Index auf `hash`,
  also Seq Scan über die ganze Tabelle bei jedem Boot.

*Lösung:* Eine spaltenagnostische Trigger-Variante, die `OLD`/`NEW` als **eine**
`jsonb`-Zeile schreibt (ein INSERT statt sechs), und bei Bulk-Operationen
`FOR EACH STATEMENT` mit `REFERENCING OLD TABLE / NEW TABLE` — das ersetzt 400
Trigger-Aufrufe durch einen. Die Kettenreihenfolge über eine dedizierte
Sequence statt über ein globales Lock herstellen.

### B13 [S2] Durchgängig `timestamp` ohne Zeitzone, Seed liefert UTC mit `Z`
Keine einzige Spalte im Projekt ist `timestamptz` (`grep timestamptz` über
`db/` und `backend/src/`: null Treffer). Betroffen: `init.sql:179`, `190`,
`232`, `233`, `254`, `275`, `276`, `279`, `282`, `298`, `299`, `368`, `369`,
`377`, `383`, `384`, `400`. Gleichzeitig ist in
`docker-compose*.yml`/`Dockerfile`/`.env.example` **kein** `TZ` oder `PGTZ`
gesetzt.

*Fehlerszenario:* `seed.sql:20` liefert `'2025-07-14T11:52:24.000Z'` in eine
`timestamp`-Spalte. Postgres **verwirft den Offset stillschweigend** und
speichert die Wanduhrzeit 11:52:24. Der DB-Container läuft auf UTC, die App
formatiert mit `toLocaleDateString('de-DE')` (`rechnungen.js:196-199`) — im
Sommer entsteht eine konstante Differenz von zwei Stunden zwischen dem, was im
Audit-Log steht, und dem, was der Nutzer gesehen hat, als er die Änderung
machte. Für ein Audit-Log, dem laut `db/README.md:121-136` Beweiskraft
zugeschrieben wird, ist das der zentrale Mangel.

Verschärft: der `bestellung_wunschdatum_check` (`init.sql:387-388`) prüft
`erfassungsdatum::date` (UTC) gegen ein vom Nutzer in Lokalzeit gedachtes
`wunschdatum` — am Tagesrand lehnt er ein gültiges Datum ab.

Und `Rechnung."Datum"`/`Lieferschein."Datum"` sind fachlich **Datumsfelder** →
`DATE`.

### B14 [S2] Request-scoped DB-Client begrenzt die App auf 25 parallele Requests — *verifiziert*
`db.js:37-43` + `db.js:105-136`: jeder Request belegt für seine **gesamte
Dauer** einen Pool-Client, `max` = 25. Der Kommentar in `db.js:35-37` räumt es
selbst ein („schon bei zwei aktiven Browser-Tabs").

`CLAUDE.md` sagt gleichzeitig: „die Tabellenansicht lädt jedes Foto einzeln".
Eine Seite mit 50 Zeilen erzeugt 50 Requests; 25 belegen Clients, der Rest
wartet bis `connectionTimeoutMillis: 10000` und fällt mit Pool-Timeout um. Die
Gegenmaßnahme war, `max` von 10 auf 25 zu erhöhen — die Ursache blieb.

Nebenwirkung: Weil alle Queries eines Requests über **einen** Client laufen,
sind `Promise.all`-Blöcke faktisch sequenziell. `dashboard.js:103-235` feuert
sieben Queries per `Promise.all` und suggeriert Parallelität, die es nicht gibt;
`etiketten.js:110` dasselbe bei bis zu 200 Einzel-Queries.

### B15 [S2] Offene Transaktion kann in den Pool zurückwandern
`db.js:54-66` gibt den Client bei `res.on('finish'|'close')` frei. Bricht der
Browser die Verbindung mitten in einer Transaktion ab, wandert der Client mit
**offener oder abgebrochener** Transaktion zurück in den Pool — node-postgres
rollt beim `release()` nicht automatisch zurück.

*Fehlerszenario:* Der nächste Request bekommt diesen Client und scheitert an
`current transaction is aborted, commands ignored until end of transaction
block` — bei einem beliebigen, völlig unbeteiligten Aufruf.

### B16 [S2] `app.current_user` wird beim Zurückgeben des Clients nicht zurückgesetzt
`db.js:97` und `db.js:120` setzen
`set_config('app.current_user', …, false)` — `false` = session-local, lebt so
lange wie die Verbindung. Beim `release()` wird nichts zurückgenommen (kein
`RESET`, kein `DISCARD ALL`). Der Audit-Trigger liest genau diesen Wert
(`init.sql:197`).

Aktuell hält die Korrektheit nur, weil jeder DB-Pfad durch
`requestContextMiddleware` (`index.js:96`) läuft. `db.js:109-111` hat aber
bereits den Fallback `if (!store) return pool.query(...)` — jeder künftige
Code, der außerhalb des Request-Kontexts schreibt (Cronjob, Hintergrundtask),
erbt einen Client mit dem **Benutzernamen des vorherigen Requests** und
schreibt ihn ins Audit-Log. Für ein Revisionsprotokoll zu fragil.

### B17 [S2] Sequences werden nach ID-Import nur teilweise zurückgesetzt
`backup.js:792-798` setzt `setval` für `app_users`, `audit_log`, `Kunde`,
`Lieferschein`, `Rechnung` — **nicht** für `lagerinventur`, obwohl die Tabelle
in `ALL_TABLES` steht (`backup.js:267`) und mit explizitem `id` importiert
wird. Gleiche Lücke in `db/json_to_sql.py:191-196` und
`db/convert_mysql_to_pg.py:132-135` (letzteres kennt nicht einmal `app_users`).

*Fehlerszenario:* Import mit `lagerinventur`-Zeilen bis `id = 57`. Die Sequence
steht weiter auf 1 → der nächste Inventur-Entwurf bekommt `id = 1` →
`duplicate key`. Und zwar **57-mal in Folge**, bis die Sequence sich
hochgearbeitet hat: für den Nutzer ein sporadisch fehlschlagendes Feature ohne
erkennbares Muster.

*Lösung:* Alle Sequences generisch über
`information_schema.columns WHERE column_default LIKE 'nextval%'` nachziehen.
Robuster: `GENERATED BY DEFAULT AS IDENTITY` statt `SERIAL`.

### B18 [S1] JSON-Backup kennt die Bestelltabellen nicht → stiller Datenverlust
`backup.js:265-276`:
```js
const ALL_TABLES = ["Schmuckstück","lagerinventur","Rechnung","Lieferschein","Kunde","audit_log","app_users"];
```
`bestellung`, `bestellung_kunde`, `bestellung_consent` (`init.sql:353-405`)
fehlen — also die komplette Bestellübersicht inklusive der verschlüsselten
Stammdaten und der Consent-Nachweise.

*Fehlerszenario:* Admin exportiert „alle Tabellen", stellt nach einem
Zwischenfall wieder her (`backup.js:719-721` truncatet mit `CASCADE`) — und
alles, was importiert wird, ist ohne Bestelldaten. Die Consent-Nachweise sind
unwiederbringlich weg, und niemand merkt es, weil der Export „vollständig"
hieß.

*Lösung:* `ALL_TABLES` nicht hart pflegen, sondern aus `pg_class`/`pg_namespace`
ableiten und topologisch nach FK-Abhängigkeit sortieren. Dann kann keine neue
Tabelle mehr durchs Raster fallen. Statt die Reihenfolge per
`[...ALL_TABLES].reverse()` (`backup.js:783`) zu raten:
`SET CONSTRAINTS ALL DEFERRED` in der Import-Transaktion.

### B19 [S2] Export ohne `ORDER BY` → Tamper-Alarm feuert falsch positiv
`backup.js:326`: `SELECT * FROM "${table}"` — ohne Sortierung, also in
Heap-Reihenfolge. Beim Import feuert `trg_audit_log_hash_chain` pro Zeile und
überschreibt `previous_hash`/`hash` anhand der **Einfüge**reihenfolge, während
`verify_audit_chain()` (`init.sql:129-153`) per
`lag(hash) OVER (ORDER BY id)` prüft. Weichen die Reihenfolgen ab — nach
`VACUUM FULL`, `pg_repack`, einem Parallel-Seq-Scan oder einem Restore —,
meldet `GET /api/audit-log/verify` tausende `chain_broken` für eine Datenbank,
an der niemand manipuliert hat. Ein Alarm, der falsch positiv feuert, wird
nach dem dritten Mal ignoriert.

Gleichzeitig ist der Schutz **wirkungslos gegen echte Manipulation am Backup**:
der Trigger rechnet jeden importierten Inhalt widerspruchsfrei neu.

*Lösung:* Export mit `ORDER BY <pk>` (macht Backups zusätzlich diffbar), Import
in `id`-Reihenfolge, und den Hash-Trigger beim Import per
`ALTER TABLE audit_log DISABLE TRIGGER` abschalten, die Original-Hashes aus dem
Backup übernehmen und danach einmal `verify_audit_chain()` laufen lassen.

### B20 [S2] `whereClauseBuilder` filtert auf eine Spalte, die es nicht gibt — *verifiziert*
`whereClauseBuilder.js:20-26`:
```js
_addTenantFilter() {
  if (this.tenantId !== null) {
    this.conditions.push(`"tenant_id" = $${this.paramIdx}`);
```
`tenant_id` existiert in **keiner** Tabelle. Aktiviert wird der Pfad von
`dashboard.js:42` (`req.user?.tenant_id ?? null`). Sobald irgendein JWT das
Feld trägt, wirft jede Dashboard-Query `column "tenant_id" does not exist`.

Schlimmer: `dashboard.js:206-209` würde dann
`WHERE "tenant_id" = $1 WHERE LEFT(…)` erzeugen — Syntaxfehler, das gesamte
Dashboard fällt aus. Der Test in `__tests__/whereClauseBuilder.test.js:276-280`
prüft nur die erzeugte Zeichenkette und bemerkt nichts.

Das ist ungetesteter Multi-Tenancy-Code auf Vorrat (YAGNI) — entweder
entfernen, oder das Schema wirklich mandantenfähig machen (dann gehört
`tenant_id` in jede Tabelle **und in jeden PK/UNIQUE**).

### B21 [S3] Datenbank-Locale nie festgelegt
`docker-compose.yml:2-11` startet `postgres:16-alpine` ohne
`POSTGRES_INITDB_ARGS`, ohne `LANG`, ohne `LC_COLLATE`. Auf Alpine/musl läuft
`lc_collate` faktisch auf `C`-Semantik hinaus — **zu verifizieren** mit
`SHOW lc_collate;`.

*Falls bestätigt:* `SELECT * FROM "Kunde" ORDER BY "Name"` (`kunden.js:28`)
sortiert byteweise — Großbuchstaben komplett vor Kleinbuchstaben (`'Zeta'` vor
`'kleine_naehliebe'`, beide Schreibweisen stehen im Seed) und Umlaute hinter
`z`. Für eine Kundenliste, die Menschen alphabetisch lesen, sichtbar falsch.

*Lösung:* ICU-Collation pro Spalte (portabler als ein `initdb`-Neustart):
```sql
CREATE COLLATION de_phone (provider = icu, locale = 'de-u-co-phonebk');
ALTER TABLE "Kunde" ALTER COLUMN "Name" TYPE varchar(100) COLLATE de_phone;
```
Achtung: invalidiert alle Indizes auf der Spalte — `REINDEX` einplanen.

### B22 [S3] Bezeichner mit Umlauten und CamelCase in Anführungszeichen
`"Schmuckstück"`, `"Länge"`, `"Anhänger_Grösse"`, `"Letzte_Änderung"`,
`"Zwischenstück"`. Was das praktisch kostet:
1. **Jede Query braucht Quotes.** Ein vergessenes `"` wird zu Kleinbuchstaben
   gefaltet → `relation "schmuckstück" does not exist`. Genau deshalb muss
   `whereClauseBuilder.js:208` Spaltennamen per Template interpolieren.
2. **`information_schema`-Abfragen werden fehleranfällig.** `db.js:257-258`
   prüft `WHERE table_name = 'Lieferschein'` — korrekt nur, weil der Name
   gequotet erzeugt wurde. Jede Migration muss pro Tabelle wissen, wie sie
   entstanden ist.
3. **Umlaute brechen an jeder Encoding-Grenze:** `pg_dump`/`psql` mit
   abweichendem `client_encoding`, CSV-Export, Dateinamen, URL-Pfade. Und
   `NEW."Letzte_Änderung"` steht als String in einem JS-Template
   (`db.js:163`) — ein falsch gespeichertes `db.js` (Latin-1 statt UTF-8)
   erzeugt einen Trigger, der zur Laufzeit auf eine nicht existente Spalte
   schreibt.
4. **Tooling-Reibung:** ORMs, Migrationsgeneratoren, `\d` in psql,
   Grafana/Metabase.

*Lösung:* Bei Neuanlage `snake_case`, ASCII-only. Umbenennen ist hier machbar
und abwärtskompatibel absicherbar:
```sql
ALTER TABLE "Schmuckstück" RENAME TO schmuckstueck;
CREATE VIEW "Schmuckstück" AS SELECT * FROM schmuckstueck;  -- + INSTEAD OF-Trigger
```

### B23 [S2] `convert_mysql_to_pg.py` kann SQL mitten in einem String-Literal zerschneiden
`db/convert_mysql_to_pg.py:64` wandelt literale `\n` in echte Umbrüche:
```python
content = content.replace("\\n", "\n")
```
`:125` ersetzt dann ein Komma vor einer Leerzeile durch ein Semikolon:
```python
content = re.sub(r",(\s*\n\s*\n)", r";\1", content)
```
*Fehlerszenario:* Ein Textfeld (`Name`, `Ausschuss_Grund`, `Anhänger`) enthält
`…Zeile1\n\nZeile2…`. Nach `:64` steht dort eine echte Leerzeile, nach `:125`
wird das Komma **innerhalb des Literals** zum `;`. Das INSERT wird
abgeschnitten, der Rest zu Syntaxmüll — mit einem Fehler, dessen Ursache 3 MB
weiter oben liegt. Analog `:59` bei Daten mit `\"`.

*Lösung:* Kein Regex auf SQL-Text. `pgloader` oder
`mysqldump --compatible=postgresql`, oder ein echter Tokenizer, der
String-Literale unangetastet lässt. Prüfsumme über die Zeilenzahl vorher/
nachher als Sicherung.

---

# C. Geschäftslogik: fehlende Transaktionen & Statusfehler

### C1 [S1] `PUT /lieferscheine/:id` ohne Transaktion — löscht den Lagerzustand — *verifiziert*
`backend/src/routes/lieferscheine.js:345-394`. Drei getrennte `db.query` ohne
`BEGIN`:
```js
:361  const { rows } = await db.query(updateQuery, params);            // 1) Kopf
:369  await db.query(`UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0
                      WHERE "Lieferschein_ID" = $1`, [req.params.id]);  // 2) Reset ALLER Positionen
:375  await db.query(`UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 …`)  // 3) Neu setzen
```
*Fehlerszenario:* Schritt 2 committet (Autocommit), Schritt 3 scheitert
(DB-Fehler, ungültige Artikelnummer, Verbindungsabbruch) → **alle** Stücke des
Lieferscheins stehen auf `Ausgelagert=0, Lieferschein_ID=0`, während der
Lieferschein weiter `status='final'` hat. Die Ware gilt als „im Lager", ist
aber beim Kunden. Kein Rollback, keine Kompensation.

Inkonsistent im eigenen Haus: `POST` derselben Datei hat `BEGIN` **und**
`LOCK TABLE` (`:248-249`).

### C2 [S1] `PUT /rechnungen/:id` ohne Transaktion — storniert Umsatz
`rechnungen.js:382-439`, identisches Muster:
```js
:414  await db.query(`UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = 0 WHERE "Rechnung_ID" = $1`, …);
:420  await db.query(`UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 …`)
```
Bricht Schritt 2 ab, sind sämtliche Positionen einer **finalen** Rechnung auf
`Verkauft=0` zurückgesetzt → der Dashboard-Umsatz (`dashboard.js:124`) verliert
die Beträge, die Stücke erscheinen wieder als verfügbar und können **doppelt
verkauft** werden. Die Rechnung bleibt `final`.

### C3 [S1] Beide DELETE-Handler ohne Transaktion
`lieferscheine.js:417-437` und `rechnungen.js:462-482`: erst Reset der
Positionen, dann `DELETE`.

*Fehlerszenario:* Rechnung 42 ist über
`bestellung.rechnung_nummer REFERENCES "Rechnung"("Nummer")` (`init.sql:381`,
`NO ACTION`) gebunden. Das UPDATE committet: 30 Artikel stehen auf
`Verkauft=0, Rechnung_ID=0`. Das DELETE scheitert mit 23503, HTTP 500. Die
Rechnung existiert weiter, ihre Positionen sind alle zurückgesetzt → der
Monatsumsatz ist weg, die Rechnung ist leer, und der Audit-Trigger hat 60
„Korrektur"-Zeilen geschrieben, die nie eine Korrektur waren.

Zusatz: bei `rowCount === 0` wird trotzdem vorher das UPDATE gefahren und
danach 404 geliefert.

### C4 [S1] SumUp-Import: Transaktion beginnt zu spät — *verifiziert*
`backend/src/routes/sumup.js:199-210`:
```js
:199  const { rows: newKunde } = await db.query(
        `INSERT INTO "Kunde" (…) VALUES ('Messe', '', 0, '', 0, 0, true) RETURNING …`);  // vor BEGIN!
:210  await db.query("BEGIN");
```
Der Messe-Kunde wird **außerhalb** der Transaktion angelegt und bleibt bei
Rollback bestehen. Auch die Artikelauswahl (`:144-169`) läuft vor `BEGIN` —
zwei parallele Imports selektieren dieselben verfügbaren Stücke und schreiben
sie auf zwei verschiedene Rechnungen (TOCTOU).

Nebenbefund: `WHERE "Name" ILIKE '%messe%' LIMIT 1` (`:195`) ohne `ORDER BY` —
gibt es einen echten Kunden „Messebau Müller", ist nicht vorhersagbar, welcher
gewählt wird.

### C5 [S1] SumUp erzeugt einen Status, der in keinem Mapping vorkommt
`sumup.js:246` setzt `Ausgelagert = <MesseID>`, `sumup.js:285` setzt für
**dieselben** Artikel `Verkauft = 1`. Der Endzustand
`Ausgelagert>0 AND Verkauft=1` ist in keinem Status-Mapping vorgesehen.

*Folge:* Wird die Rechnung später gelöscht (`rechnungen.js:466` setzt nur
`Verkauft=0`), bleibt `Ausgelagert=<MesseID>` stehen → das Stück ist dauerhaft
„aktiv ausgelagert bei Messe", nie mehr `verfuegbar()`, und taucht in der
Inventur als Kundenbestand auf. Der einzige Weg zurück ist
`kunden.js:228 /restock` — der seine eigenen Probleme hat (C7).

### C6 [S1] `Verkauft = 1` ohne `Ausschuss`-Guard
`rechnungen.js:302` / `:421`:
```js
UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[])
```
Ein Ausschussstück lässt sich auf eine finale Rechnung setzen. Ergebnis
`Verkauft=1 AND Ausschuss=1` fällt aus dem Mapping „Verkauft" heraus
(`whereClauseBuilder.js:30` fordert `Ausschuss = 0`) → die Position ist
berechnet, erscheint aber nirgends als Umsatz.

`sumup.js:238-239` macht es richtig (`nichtVerkauft().keinAusschuss()`),
`lieferscheine.js`/`rechnungen.js` nicht.

### C7 [S1] `/restock` setzt auch verkaufte Stücke zurück und lässt `Lieferschein_ID` stehen — *verifiziert*
`backend/src/routes/kunden.js:228-243`:
```js
const builder = where();
builder.ausgelagert(parseInt(req.params.id));
await db.query(`UPDATE "Schmuckstück" SET "Ausgelagert" = 0 ${builder.build()}`, builder.getParams());
```
`ausgelagert()` filtert **nur** auf `"Ausgelagert" = $1` — anders als
`aktivAusgelagert()` ohne `Verkauft=0 AND Ausschuss=0`.

*Folge 1:* Ein beim Kunden **verkauftes** Stück verliert den Kundenbezug →
`inventur.js:55` (`JOIN … ON s."Ausgelagert" = k."ID"`) findet es nicht mehr,
`wert_verkauft` und damit die **Provisionsbasis des Kunden** sinken rückwirkend.

*Folge 2:* `Lieferschein_ID > 0` bleibt gesetzt. Das Stück ist jetzt
`verfuegbar()` **und** gleichzeitig Position eines Lieferscheins
(`GET /lieferscheine/:id` listet es weiter) → es kann ein zweites Mal
ausgeliefert werden. Gleiches in `/restock-selective` (`:288-296`).

### C8 [S1] `PUT /schmuckstuecke/:id` setzt Statusfelder auf NULL, wenn sie fehlen
`schmuckstuecke.js:1348-1349` schreibt `Ausgelagert`, `Verkauft`, `Ausschuss`,
`Lieferschein_ID`, `Rechnung_ID` immer mit. Alle sind im Schema über
`zahl()`/`ganzzahl()` deklariert → `.nullish()` (`schemas/common.js:34`). Ein
PUT ohne diese Felder schreibt **NULL**.

Danach matcht das Stück keine einzige Status-Bedingung mehr: `verfuegbar()`
verlangt `= 0`, `aktivAusgelagert()` verlangt `> 0` — `NULL` erfüllt beides
nicht. Das Stück fällt aus Liste, Dashboard, Inventur und SumUp-Export heraus.

### C9 [S2] `Ausgelagert` wird beim Anlegen eines Lieferscheins ohne Prüfung überschrieben
`lieferscheine.js:269`. Ist ein Stück schon bei Kunde A ausgelagert, wird
`Ausgelagert` stillschweigend auf Kunde B umgebogen — Kunde A verliert die
Position aus Inventur und Provisionsabrechnung, ohne jede Meldung.

Ebenso wird `rowCount` nie geprüft: nicht existierende Artikelnummern im Array
werden ignoriert, der Lieferschein wird mit 201 quittiert, enthält aber weniger
Positionen als angefragt.

### C10 [S1] Kunde löschen lässt Zähler-Referenzen verwaisen
`kunden.js:329-344` — siehe B3. Zusätzlich fehlt die Unterscheidung von
FK-Verletzung (409 mit Erklärung) und echtem Serverfehler (500).

### C11 [S1] Kopier-Block überschreibt die Benutzereingabe — *verifiziert*
`schmuckstuecke.js:1158-1197`:
```js
// Daten von Produkt holen, sobald das form nicht ausgefüllt ist
if (b.Artikelnummer) {
  const { rows } = await client.query(
    `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 || '_' || $2`,
    [baseArtikelnummer, startSuffix - 1]);
  if (rows.length > 0) {
    b.Name = rows[0].Name; … b.Verkaufspreis = rows[0].Verkaufspreis; …
```
Der Kommentar behauptet „sobald das form nicht ausgefüllt ist" — geprüft wird
das nie: `Artikelnummer` ist Pflichtfeld, die Bedingung ist **immer wahr**.

*Folge:* Wer ein weiteres Exemplar von `MHO123` mit **korrigiertem Preis oder
Namen** anlegt, bekommt stillschweigend die Werte des Vorgängers. Der
eingegebene Preis ist weg, ohne Meldung.

Dazu im gleichen Block: `b.Ausschuss_Grund` wird vom Vorgänger kopiert, während
`b.Ausschuss = 0` erzwungen wird → Datensatz mit Ausschussgrund, der kein
Ausschuss ist. Und `b.Farbe = rows[0].Farbe` steht zweimal drin.

### C12 [S2] Bulk-Insert verwirft `Ausschuss`, behält aber den Grund
`schmuckstuecke.js:608-611`:
```js
0,                      // Ausgelagert
0,                      // Verkauft
0,                      // Ausschuss   <-- item.Ausschuss wird verworfen
ausschussGrundValue,    // stammt aus item.Ausschuss/item.Ausschuss_Grund
```
`resolveAusschussGrund(item.Ausschuss, …)` liefert bei `Ausschuss=1` „Defekt",
eingefügt wird aber `Ausschuss=0`. Die Constraint-Behandlung in `:631` kann
dadurch nie greifen — toter Code.

### C13 [S2] SumUp: Verkaufsmenge > 1 wird verschluckt
`sumup.js:98` sammelt Artikelnummern in einem `Set`, `:157-169` übernimmt pro
angefragter Nummer **genau einen** Treffer. Verkauft die Messe zwei Exemplare
von `MHO123` (zwei CSV-Zeilen oder eine Zeile mit Menge 2), wird nur eines als
verkauft markiert — das zweite bleibt für immer „verfügbar", obwohl es weg ist.
Die Mengenspalte der SumUp-CSV wird nirgends gelesen.

### C14 [S2] SumUp-CSV-Parser kennt nur Komma
`sumup.js:599` splittet hart auf `,`. SumUp-Exporte im deutschen
Excel-Format sind semikolonsepariert; dann ist jede Zeile ein einziges Feld,
`row["Beschreibung"]` ist `undefined`, und der Import endet in „Keine gültigen
Artikelnummern gefunden" (400) — ohne Hinweis auf das Trennzeichen.

Zusätzlich `:601`/`:607`: `currentField.trim()` wird auch **innerhalb** von
Anführungszeichen angewandt, also nicht RFC-4180-konform (der Kommentar
behauptet es).

### C15 [S2] Nummernvergabe per `MAX+1` ohne Lock
`schmuckstuecke.js:1132-1150`: `BEGIN` steht davor (`:1127`), aber **kein**
`LOCK TABLE` — im Gegensatz zu `lieferscheine.js:249` und `rechnungen.js:279`.
Zwei gleichzeitige „MHO"-Anlagen berechnen dieselbe Nummer; die zweite
scheitert am Primary Key und liefert 500, statt eine freie Nummer zu nehmen.
Dasselbe in `sumup.js:215-221`/`:254-262` mit einem JS-seitigen Zähler
(`naechsteRechnungsnummer++`).

### C16 [S2] `_` im LIKE-Pattern nicht escaped
`schmuckstuecke.js:1148`: `` [`${baseArtikelnummer}_%`] ``. In SQL-`LIKE` ist
`_` ein Platzhalter für ein beliebiges Zeichen — `'MHO123_%'` matcht daher auch
`MHO1234`. `etiketten.js:104` escapt korrekt (`${artikelnummer}\\_%`), hier
nicht. Aktuell folgenlos, solange alle Nummern dem Muster entsprechen; bei
Importdaten berechnet `MAX(SUBSTRING(…,8))` dann Unsinn.

### C17 [S1] Die Rechnung widerspricht sich selbst — *verifiziert*
`backend/src/utils/excelService.js`:
```js
:500  const menge = articleCounts[artikelnummerBasis] || 1;
:501  const einzelpreisOriginal = Number(s.Verkaufspreis) || 0;   // Preis des ERSTEN Stücks
:514  row.getCell(9).value = einzelpreis * menge;                 // Positionssumme
…
:528  const total = data.schmuckstuecke.reduce((sum, s) => …      // echte Einzelpreise
        sum + (Number(s.Verkaufspreis) || 0) * (1 - rabatt / 100), 0);
```
Zeilen werden per `processedArticles` (`:454-460`) auf die Basis-Artikelnummer
dedupliziert und mit `menge` multipliziert — der Einzelpreis stammt aber vom
**ersten** Stück. Haben `MHO123_1` (20 €) und `MHO123_2` (25 €)
unterschiedliche Preise, zeigt die Position `2 × 20 € = 40 €`, der Gesamtwert
darunter aber 45 €. Auf einem Beleg, der an Kunden geht.

### C18 [S2] Dashboard-Umsatz ignoriert Rabatte
`dashboard.js:124`:
```sql
COALESCE(SUM("Verkaufspreis") FILTER (WHERE …), 0) AS "totalRevenue"
```
`Rechnung.rabatt_gesamt`/`rabatt_positionen` gehen nicht ein, obwohl
`excelService.js:545-592` sie abzieht. Dashboard- und Monatsumsatz sind bei
jedem Rabatt zu hoch. Auch die Kundenprovision fehlt. `inventur.js:53`
(`wert_verkauft`) hat dasselbe Problem.

### C19 [S2] Inventur zählt doppelt
`inventur.js:49-53`:
```sql
SUM(CASE WHEN s."Verkauft"  = 1 THEN 1 ELSE 0 END) AS "verkauft",
SUM(CASE WHEN s."Ausschuss" = 1 THEN 1 ELSE 0 END) AS "ausschuss",
```
`CLAUDE.md` definiert „Verkauft" als `Verkauft=1 AND Ausschuss=0`. Hier fehlt
der Ausschluss → ein Stück mit `Verkauft=1, Ausschuss=1` zählt in **beiden**
Spalten, und `gesamt ≠ aktiv + verkauft + ausschuss`.

### C20 [S2] „Inventur abschließen" friert nichts ein
`lagerinventur.js:386-407` setzt nur `status='abgeschlossen'`. Der
Soll/Ist-Vergleich (`:225-361`) rechnet den Soll-Bestand aber **live** aus
`"Schmuckstück"`. Eine abgeschlossene Inventur liefert morgen ein anderes
Ergebnis als heute — als Nachweis wertlos.

Dazu haben `stats.soll` (`:349`, Stückzahl) und `stats.gescannt` (`:350`, Summe
der Zählmengen) unterschiedliche Semantik, werden aber verglichen.

### C21 [S2] Zählmenge pro vollständiger Artikelnummer ist widersprüchlich
`lagerinventur.js:267-270` summiert Zählmengen pro Basisnummer auf. Weil
`Artikelnummer` Primary Key ist, existiert nie mehr als **ein** Stück je
vollständiger Nummer — das Schema erlaubt aber `{ "MHO123_1": 3 }`
(`schemas/index.js:220-223`, max 100000). `Ist` wird dann um 2 zu hoch und das
Stück landet unter „zuviel". *(Zu klären, welche Variante das Frontend
schickt.)*

### C22 [S2] Foto wird vor der Transaktion geschrieben
`bestelluebersicht.js:356-363`: `speichereBestellungFoto(foto)` legt die Datei
an, bevor `BEGIN` läuft (`:366`). Bei Rollback bleibt eine verwaiste Datei im
Upload-Verzeichnis, auf die nichts mehr zeigt. Identisch in POST
(`:221-227` vor `:230`).

### C23 [S2] Fehlender Status setzt eine abgeschlossene Bestellung zurück
`bestelluebersicht.js:386`: `status || 'offen'`. `bestellungUpdateSchema.status`
ist optional (`schemas/index.js:213`) → ein PUT ohne `status` setzt eine
**abgeschlossene** Bestellung auf `offen`. Und der Wert wird nicht gegen das
Enum `bestellstatus_typ` validiert → `status: "fertig"` ⇒ 22P02 ⇒ 500 statt 400.

### C24 [S2] N+1: eine Query pro Etikett
`etiketten.js:101-112` feuert je Artikel ein eigenes
`SELECT * FROM "Schmuckstück" … LIMIT 1`. Bei 200 Etiketten = 200 Queries — und
weil alle über denselben request-gebundenen Client laufen (B14), werden sie
zusätzlich **serialisiert**; `Promise.all` bringt hier nichts. Ein
`WHERE split_part("Artikelnummer",'_',1) = ANY($1)` würde eine Query genügen.

### C25 [S2] Unvalidierte Zahlen-Parameter → 500 statt 400
- `schmuckstuecke.js:700-702`, `:815`: `limit` nur per `isNaN` geprüft, kein
  Min/Max. `limit=-1` (der dokumentierte „alle laden"-Wert) ergibt
  `Math.ceil(100 / -1) = -100` → negative Seitenzahlen im JSON; `limit=0` ergibt
  `NaN`; `LIMIT -5`/`OFFSET -50` ⇒ Postgres-Fehler ⇒ 500.
- `schmuckstuecke.js:755`, `:759`: `builder.equals("Verkauft", parseInt(verkauft))` —
  `?verkauft=` oder `?verkauft=abc` ⇒ `NaN` als Query-Parameter ⇒
  `invalid input syntax for type smallint` ⇒ 500. Auch bei doppeltem
  Query-Parameter (`?verkauft=1&verkauft=0` → Array → `NaN`).
- `inventur.js:112` gibt `kundeId` als **String** in `"Ausgelagert" = $1` ⇒
  22P02 ⇒ 500.
- `lagerinventur.js:58`, `:168`, `:386`: `req.params.id` direkt in
  `WHERE id = $1` — `/drafts/abc` ⇒ 500. Das vorhandene `idParam`-Schema
  (`schemas/common.js:51`) wird hier nicht genutzt.
- `kunden.js:185-204` (PUT): `Provision`/`Aktiv` sind laut Schema optional, die
  Spalten sind `NOT NULL` ⇒ 23502 ⇒ 500 statt 400.
- `lieferscheine.js:350-359` / `rechnungen.js:387-404` (PUT): `Nummer` ist per
  Schema optional, die Spalte ist Primary Key ⇒ PUT ohne `Nummer` schreibt
  NULL ⇒ 500.
- `kunden.js:142-156` (POST): doppelter Name ⇒ 23505 ⇒ generisches 500, kein
  409 — im Gegensatz zu lieferscheine/rechnungen, die es richtig machen.

### C26 [S3] Debug-Rückstand: interner Fehler als Nutzermeldung — *verifiziert*
`schmuckstuecke.js:1001-1004`:
```js
res.status(500).json({
  // error: "Fehler beim Laden der einzigartigen Artikelnummern",
  error: String(err),
});
```
Auskommentierte Meldung, stattdessen `String(err)`. Einzige Route mit diesem
Verhalten. Dasselbe `details: err.message`-Muster in `sumup.js:341-344`,
`schmuckstuecke.js:293` und in allen fünf `lagerinventur.js`-Handlern.

### C27 [S2] `lagerinventur.js` loggt keinen einzigen Fehler
Alle fünf Handler (`:31`, `:69`, `:121`, `:182`, `:399`) antworten mit
`res.status(500).json({ error: …, details: err.message })` — **ohne**
`logger.error`. Jede andere Route loggt. Fehler in diesem Feature sind
serverseitig unsichtbar.

### C28 [S2] Validierungsfehler als 500
`bestelluebersicht.js:274`/`:416` erkennt DB-Trigger-Exceptions per
`err.message?.includes('DSGVO') || err.message?.includes('erfordert')` und
antwortet mit **500**. Ein Eingabefehler ist damit für das Frontend nicht von
einem Serverausfall unterscheidbar — und die String-Erkennung bricht bei jeder
Meldungsänderung.

### C29 [S2] `ROLLBACK` ohne eigenes try/catch
`schmuckstuecke.js:630` und `:1256`: `await client.query("ROLLBACK")` ungeschützt.
Scheitert das ROLLBACK (typisch: Verbindungsverlust, also genau der Fehlerfall),
wirft der catch-Block selbst → die eigentliche Fehlermeldung geht verloren und
der Client wird im `finally` mit offener Transaktion freigegeben.
`lieferscheine.js:292-296`, `rechnungen.js:325-329` und
`bestelluebersicht.js:264-268` machen es richtig.

### C30 [S2] Foto-Handling: leerer catch, Endungs-Kollision, FS/DB-Divergenz
- `utils/photoIndex.js:26-29`: `} catch { return cache; }` — `statSync`-Fehler
  (Verzeichnis gelöscht, Rechteproblem) werden völlig stumm geschluckt; der
  Index bleibt auf altem Stand, alle Fotos „existieren" weiter, obwohl
  `sendFile` dann 404 liefert.
- `photoIndex.js:34-37`: bei `MHO123.jpg` **und** `MHO123.png` gewinnt der
  erste `readdir`-Treffer → nach einem Upload mit anderer Endung wird weiter
  das alte Bild ausgeliefert (`schmuckstuecke.js:24-35` löscht die Altdatei
  nicht).
- `schmuckstuecke.js:31-33`: Multer-Dateiname aus
  `req.query.artikelnummer || "unknown"` — ohne Query-Parameter heißt jedes
  Foto `unknown.jpg` und wird beim nächsten Upload überschrieben. Die
  DB-Spalte `Foto` wird beim Upload gar nicht gesetzt (nur
  `invalidatePhotoIndex()`) → Dateisystem und DB divergieren dauerhaft.

### C31 [S3] Weitere Kleinigkeiten
- `schmuckstuecke.js:987-991`: Subquery in `FROM` **ohne Alias**. Läuft nur auf
  PostgreSQL 16+ (Compose nutzt `postgres:16-alpine`); auf ≤ 15 ein
  Syntaxfehler. Nicht portabel — auffällig, weil alle anderen Subqueries einen
  Alias haben (`dashboard.js:163`: `) s`).
- `rechnungen.js:175`/`lieferscheine.js:175`: `SELECT r.*, k.*` — die Spalte
  `"ID"` existiert in beiden Tabellen, im Row-Objekt gewinnt `k."ID"`.
  `rows[0].ID` ist also die **Kunden**-ID, nicht die Dokument-ID. Aktuell wird
  nur `Nummer` genutzt, die Falle bleibt.
- `etiketten.js:90`: `qty: Math.max(1, parseInt(item?.qty, 10) || 1)` — nach
  oben unbegrenzt; `qty: 1000000` erzeugt eine Million Etiketten-Divs.
- `etiketten.js:326`: `Math.max(10, Math.min(parsedLimit, 500))` — ein
  angefragtes `limit=5` liefert **10** Treffer (stille Korrektur nach oben).
- `etiketten.js:329-339`: greift auf `builder.conditions`/`.params`/`.paramIdx`
  direkt zu statt auf `raw()`, und liest `limitParam` **vor** `build()` — sobald
  `tenantId` gesetzt wird, zeigt `LIMIT $n` auf den Tenant-Parameter.
- `sumup.js:247`: `updateBuilder.build().replace(/\$1/g, …)` —
  Parameter-Renumbering per Regex. Funktioniert nur, weil der Builder genau
  einen Parameter hat; bei zwei ersetzt `/\$1/g` auch das `$1` in `$10`…`$19`.
  `getNextParamIdx()` wäre der vorgesehene Weg.
- `bestelluebersicht.js:383-393`: `RETURNING *` wird verworfen und `rowCount`
  nicht geprüft → wird die Bestellung zwischen Prüfung (`:339`) und UPDATE
  gelöscht, wirft `toBestellungResponse(undefined)` **nach** dem COMMIT ⇒ 500
  trotz erfolgreicher Änderung.
- `schmuckstuecke.js:736-742`: Datumsfelder werden per `::text` + `ILIKE '%…%'`
  durchsucht → nur ISO-Format trifft, `01.03.2026` findet nie etwas, und
  `%2026%` matcht auch Preise mit dieser Ziffernfolge.
- `lieferscheine.js:13`, `rechnungen.js:13`, `sumup.js:214`: `aktuellesJahr`
  kommt aus `new Date().getFullYear()` (Zeitzone des Node-Prozesses), das
  `Datum` aus `CURRENT_TIMESTAMP` (Zeitzone des DB-Servers). Am 1. Januar
  00:30 MEZ auf einem UTC-Container: Nummer `2026-001` mit Datum `2027-01-01`.
- `sumup.js:108`: `logger.debug('SUMUP', 'CSV-Zeile', { idx, ...row })` schreibt
  komplette Zahlungsbericht-Zeilen ins Log.

---

# D. Validierung, Artikelnummer, Geldeingabe

### D1 [S1] Preisfeld leeren ⇒ `NaN` ⇒ `NULL` in der Datenbank — *verifiziert*
`frontend/src/pages/Schmuckstuecke.jsx`:
```jsx
:1776   Verkaufspreis:      parseFloat(e.target.value),
:1791   Herstellungskosten: parseFloat(e.target.value),
:1450   Grösse:             parseFloat(e.target.value),
:1462   Länge:              parseFloat(e.target.value),
:1623   Anhänger_Grösse:    parseFloat(e.target.value),
```
`parseFloat("")` ist `NaN`, und `JSON.stringify({x: NaN})` ergibt `{"x":null}`
— beim Leeren des Feldes geht ein **explizites `null`** ans Backend. Die Spalte
ist nullable (`DEFAULT 0` greift nur beim INSERT ohne Spalte), das UPDATE setzt
also tatsächlich `NULL`.

*Folge:* `SUM("Verkaufspreis")` überspringt NULL stillschweigend → der
Inventurwert ist zu niedrig, ohne Fehlermeldung.

Beweis, dass es ein Versehen ist: **eine** Fundstelle hat den Schutz
(`:1056`: `parseFloat(e.target.value) || 0`), fünf haben ihn nicht.

### D2 [S1] Deutsche Komma-Eingabe wird stillschweigend zu `NULL` — *verifiziert*
Die Preisfelder sind `<input type="number">` (`Schmuckstuecke.jsx:1770`,
`1785`, `1446`, `1458`, `1617`). Browser geben bei ungültiger Zahleneingabe
**den leeren String** zurück. Wer im deutschen Gebietsschema `12,50` eintippt,
erzeugt `e.target.value === ""` → `parseFloat("")` → `NaN` → `null` (D1).
**Kein** Validierungsfehler, keine rote Markierung — der Preis ist weg.

Backend dieselbe Lücke: `schemas/common.js:26-34` nutzt `Number(bereinigt)`,
und `Number("12,50")` ist `NaN` → zod meldet „muss eine Zahl sein". Es gibt an
**keiner** Stelle ein `.replace(',', '.')` (per Suche über `frontend/src`
verifiziert). Für einen deutschsprachigen Betrieb der wahrscheinlichste
Alltagsfehler im ganzen Projekt.

Gleiches Problem bei `Kunden.jsx:217`/`:241`/`:276` — `type="number"` für
Hausnummer/PLZ/Provision. `type="number"` entfernt führende Nullen schon im
Eingabefeld: `01067` wird `1067` (vgl. B8).

### D3 [S1] Zwei verschiedene Artikelnummer-Formate im gleichen Code — *verifiziert*
- `schemas/common.js:64`:
  `ARTIKELNUMMER_REGEX = /^[A-Za-zÄÖÜäöü]{3}\d{3}(_\d+)?$/`
  → erlaubt **Kleinbuchstaben und Umlaute**.
- `schmuckstuecke.js:1142`: `/^[A-Z]{3}\d{3}$/.test(baseArtikelnummer.toUpperCase())`
  → nur ASCII-Großbuchstaben, kein Suffix.

Eine Artikelnummer mit `Ä` passiert die Validierung, fällt in der
Suffix-Generierung aber in einen anderen Zweig. Zwei Wahrheiten über das Format
desselben Primärschlüssels.

### D4 [S1] Artikelnummer wird nicht an der Grenze normalisiert — Datensatz wird unfindbar — *verifiziert*
Das zod-Schema (`common.js:66-70`) macht nur `.trim()`, **kein**
`.toUpperCase()`. Normalisiert wird stattdessen verstreut an 11 Stellen in
4 Dateien: `schmuckstuecke.js:112`, `118`, `134`, `382`, `714`, `1131`,
`1142-1143`, `1154`; `sumup.js:115`, `158`, `162`; `etiketten.js:323`.

Gleichzeitig filtert der Builder mit `SUBSTRING("Artikelnummer",1,1) = $1` und
`buchstabe.toUpperCase()` (`whereClauseBuilder.js:174-175`) — also gegen den
**Suchbegriff** großgeschrieben, nicht gegen den **gespeicherten Wert**.

*Fehlerszenario:* Ein Stück landet über einen nicht-normalisierenden Pfad als
`mho123` in der DB. Danach ist `SUBSTRING('mho123',1,1) = 'm' ≠ 'M'` → das
Stück erscheint in **keinem** Hersteller-, Grundmaterial- oder
Produktartfilter. Und weil `Artikelnummer` Primary Key ist (B5), existieren
`MHO123` und `mho123` als **zwei Zeilen für ein physisches Schmuckstück**.

*Lösung:* Genau eine Stelle: `.transform(s => s.toUpperCase())` im zod-Schema,
plus `CHECK ("Artikelnummer" = UPPER("Artikelnummer"))` in der DB.

### D5 [S2] `GRUNDMATERIAL`/`PRODUKTART` existieren nur in JavaScript
`utils/constants.js` definiert 17 Grundmaterial- und **4** Produktart-
Buchstaben. Die Regex erlaubt jede Buchstabenkombination, und in der DB gibt es
weder Referenztabelle noch CHECK — `MZZ123` ist gültige Eingabe.
`schmuckstuecke.js:804` fängt das mit `… || "Unbekannt"` ab: das Stück
erscheint in Auswertungen als „Unbekannt", statt beim Anlegen abgelehnt zu
werden. Fehler werden nach hinten verschoben, wo sie teurer sind.

### D6 [S2] Lockere und strenge Artikelnummer-Validierung uneinheitlich verwendet
`common.js` exportiert `artikelnummer` (beliebiger Text bis 20 Zeichen) und
`vollstaendigeArtikelnummer` (mit Regex). Beim Anlegen greift die lockere
Variante. Da der Wert **Primärschlüssel** der Haupttabelle ist, legt ein
Tippfehler einen neuen Datensatz an statt den bestehenden zu aktualisieren.

### D7 [S2] Die einzige CHECK-Constraint im Projekt ist `NOT VALID` — *verifiziert*
`db.js:815-820`:
```sql
ALTER TABLE "Schmuckstück"
ADD CONSTRAINT schmuckstueck_ausschuss_grund_required_chk
CHECK (COALESCE("Ausschuss",0) = 0
       OR LENGTH(BTRIM(COALESCE("Ausschuss_Grund",''))) > 0) NOT VALID;
```
`NOT VALID` ist als **erster** Schritt einer Online-Migration richtig, braucht
aber einen zweiten: es folgt nirgends ein `VALIDATE CONSTRAINT`. Bestehende
Ausschuss-Stücke ohne Grund bleiben dauerhaft im Bestand, der Planner nutzt den
Constraint nicht, und niemand weiß, wie viele Verstöße existieren. Der
Constraint fehlt außerdem in `init.sql` — eine Neuinstallation bekommt ihn nur,
wenn das Backend startet.

---

# E. Frontend, Build, Deployment, CI

### E1 [S1] Produktions-Compose verliert alle Fotos beim Update — *verifiziert*
Fotos liegen in `backend/src/assets/uploads/`. `Dockerfile:30` kopiert
`backend/src` **in das Image**. `docker-compose.yml` mountet für den
`app`-Service **kein Volume** für Uploads — der einzige Treffer im ganzen Repo
ist `docker-compose.synology.yml:56`.

*Fehlerszenario:* Der in `CLAUDE.md` dokumentierte Produktionsweg
`docker compose up --build -d` legt alle Fotos im Container-Dateisystem ab. Das
nächste `up --build` (oder jedes `docker compose down`) erstellt den Container
neu → **alle Fotos sind weg**. `db/backup.sh` sichert nur die Datenbank. Die
`Foto`-Spalte zeigt danach auf nicht existierende Dateien.

Ein Uploads-Export existiert (`GET /backup/export-uploads` als ZIP,
`backup.js:364`), aber nur als **manuelle Admin-Aktion** — nicht im
automatischen Backup.

*Lösung:* Named Volume für `/app/src/assets/uploads` in `docker-compose.yml`
(wie es die Synology-Variante schon tut), plus `db/backup.sh` um einen
Uploads-Tarball erweitern.

### E2 [S1] `backup.sh`: Rotation zählt Dateien statt Tage, Teil-Dumps bleiben liegen — *verifiziert*
`db/backup.sh` ist mit `set -euo pipefail` (`:19`) grundsätzlich richtig
aufgesetzt, hat aber vier Logikfehler:
- **`:35`** `pg_dump … | gzip > "${DAILY_FILE}"`: Die Shell erzeugt die
  Zieldatei **vor** dem Start von `pg_dump`. Schlägt der Dump fehl, beendet
  `pipefail` das Skript — die abgebrochene, unbrauchbare `.sql.gz` **bleibt
  liegen**. Beim nächsten Lauf zählt `ls -1t` (`:47`) sie als gültiges Backup
  und verdrängt ein funktionierendes. Nach `KEEP_DAILY` Tagen stillen
  Scheiterns sind alle sieben guten Backups durch sieben kaputte ersetzt.
- **`:46-49`** Rotation über `ls -1t | tail -n "+$((KEEP_DAILY+1))"` behält die
  7 **neuesten Dateien**, nicht 7 Tage. Sieben manuelle Läufe an einem
  Vormittag reduzieren das Aufbewahrungsfenster von einer Woche auf zwei
  Stunden — im Widerspruch zu `db/README.md:181` („Maximaler Datenverlust:
  1 Tag").
- **Keine Validierung.** Nirgends wird geprüft, ob der Dump lesbar ist. Ein
  200-Byte-Dump rotiert die guten Backups genauso weg wie ein vollständiger.
- **`:39`** Das Weekly ist ein `cp` derselben Datei — ein korruptes Daily wird
  zum korrupten Weekly. Und läuft der Cron an einem Sonntag nicht (Host aus,
  DST-Sprung), entsteht in dieser Woche kein Weekly, während die Rotation
  weiterläuft.

*Lösung:* In eine temporäre Datei dumpen, nach erfolgreichem `gzip -t` +
Plausibilitätsprüfung atomar per `mv` an den Zielnamen schieben,
`trap 'rm -f "$TMP"' ERR`. Rotation über `find … -mtime +7 -delete`. Das Weekly
als eigenen `pg_dump`. Und regelmäßig einen Restore-Test fahren — ein Backup,
das nie zurückgespielt wurde, ist unbewiesen.

### E3 [S1] `restore.sh` löscht die Datenbank, bevor es das Backup prüft — *verifiziert*
`db/restore.sh:56-60`:
```bash
psql … -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";"
psql … -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";"
gunzip -c "${BACKUP_FILE}" | psql … -v ON_ERROR_STOP=1
```
Geprüft wird nur, ob die Datei **existiert** (`:43`) — nicht, ob das Gzip
lesbar oder der Dump vollständig ist. Bei einem korrupten Backup (genau das,
was E2 produziert) ist die Datenbank **weg** und der Restore scheitert: Ergebnis
ist eine leere Datenbank. Kein `gunzip -t`-Vorabtest, kein Sicherheits-Dump des
aktuellen Stands, und trotz der Warnung im Kommentar keine
`Sind Sie sicher? [j/N]`-Rückfrage.

**Und eine Wechselwirkung mit A6:** `pg_terminate_backend` (`:53`) trennt die
App. Der Pool wirft einen Idle-Client-Fehler → `process.exit(-1)` → Docker
startet per `restart: always` neu → das Backend verbindet sich zur frisch
erzeugten leeren DB und startet seine `ensureX`-Migrationen **parallel zum
laufenden psql-Restore**. Die `CREATE TABLE` aus dem Dump (ohne
`IF NOT EXISTS`) treffen dann auf bereits existierende Tabellen ⇒
`ON_ERROR_STOP=1` bricht ab ⇒ **teilweise wiederhergestellte Datenbank**.
`db/README.md:96-110` dokumentiert `docker compose exec db /restore.sh …`
**ohne** den Hinweis, vorher den `app`-Container zu stoppen. *(Timing-abhängig,
der Mechanismus ist aber real.)*

### E4 [S2] 322 Verstöße gegen die eigene „STRICT RULE" — *verifiziert*
`CLAUDE.md` sagt: „**STRICT RULE: No inline styles**", `style={{…}}` sei
„❌ FORBIDDEN". Tatsächlich im Code:

| Datei | `style={{` |
|---|---|
| `frontend/src/pages/Inventur.jsx` | 131 |
| `frontend/src/pages/Dashboard.jsx` | 50 |
| `frontend/src/pages/Datensicherung.jsx` | 43 |
| `frontend/src/pages/DocumentManager.jsx` | 20 |
| `frontend/src/pages/Sumup.jsx` | 18 |
| `frontend/src/pages/Schmuckstuecke.jsx` | 13 |
| `frontend/src/pages/Benutzerverwaltung.jsx` | 12 |
| `frontend/src/pages/SchmuckstueckDetail.jsx` | 11 |
| `frontend/src/App.jsx` | 8 |
| `frontend/src/pages/Debug.jsx` | 7 |
| 4 weitere Dateien | je 2–3 |
| **Summe** | **322** |

Nichts setzt die Regel durch: keine ESLint-Rule (`react/forbid-dom-props`), und
die Frontend-Lint-Stufe läuft **gar nicht** in der CI (E5). Eine Regel ohne
Durchsetzung ist Dokumentationsschuld.

### E5 [S2] Die CI prüft weniger, als das Projekt an Werkzeugen mitbringt — *verifiziert*
`.github/workflows/tests.yml`:
- **Kein `--coverage`.** `backend/package.json` definiert `coverageThreshold`
  (branches 31, functions 42, lines 36, statements 36), aber `npm test` ist
  `jest --forceExit` ohne `--coverage`. Die Schwelle wird **nie** geprüft —
  toter Konfigurationsballast. (31 % Branch-Coverage als Ziel ist für eine
  Warenwirtschaft ohnehin niedrig.)
- **Kein Frontend-Lint.** `frontend/package.json` hat `lint: eslint .` und
  `eslint-plugin-react-hooks` installiert; die CI ruft nur `npm test`. Genau
  die Regel, die fehlende `useEffect`-Dependencies findet, läuft nicht.
- **Keine E2E-Tests.** `playwright.config.ts`, `e2e/*.spec.ts` und
  `npm run test:e2e` existieren — **kein** Workflow ruft sie auf.
- **`jest --forceExit`** verdeckt offene Handles (nicht geschlossener Pool,
  laufende Timer) statt sie zu beheben.
- **Kein `@vitest/coverage-v8`-Einsatz**, obwohl installiert.
- **Trigger nur `pull_request`**, nicht `push` auf `main` → ein Merge-Commit
  wird nicht erneut geprüft.

### E6 [S2] Kaputtes Workspace-Setup: drei Lockfiles — *verifiziert*
Root-`package.json` deklariert `workspaces: ["backend", "frontend"]`. Es
existieren aber **drei** Lockfiles: `package-lock.json` (Root, 238 KB),
`backend/package-lock.json` (316 KB), `frontend/package-lock.json` (164 KB).

`CLAUDE.md` weist Entwickler auf `npm install` im Root (Root-Lockfile), die CI
macht `npm ci` in `backend/` bzw. `frontend/` (Package-Lockfiles). Beide
Auflösungen können auseinanderlaufen → die CI testet andere
Abhängigkeitsversionen als Entwicklung und Produktion.

### E7 [S2] `npm install` statt `npm ci` im Dockerfile
`Dockerfile:18` (`RUN npm install`) und `:25` (`RUN npm install --production`).
`npm install` darf das Lockfile aktualisieren → der Produktionsbuild ist
**nicht reproduzierbar**; zwei Builds desselben Commits können
unterschiedliche Versionen enthalten. Korrekt: `npm ci` bzw.
`npm ci --omit=dev` (`--production` ist die veraltete Form).

### E8 [S2] Kein Healthcheck, kein Graceful Shutdown
`Dockerfile` hat keine `HEALTHCHECK`-Direktive, `docker-compose.yml` keinen
Healthcheck für `app`. Zusammen mit A3 und A6: ein hängendes oder
schema-kaputtes Backend gilt als gesund, und `docker stop` reißt laufende
Requests ab.

### E9 [S3] `PORT` ohne Default in der Compose-Datei
`docker-compose.yml:47`/`:49`: `PORT: ${PORT}` und `"3000:${PORT}"` — ohne
`:-3001`-Fallback, im Gegensatz zu allen anderen Variablen. Fehlt `PORT` in der
`.env`, wird das Mapping zu `"3000:"` und `docker compose up` scheitert.
Dasselbe bei `BESTELLUNG_ENCRYPTION_KEY`, `PRIVACY_POLICY_VERSION` und den
beiden `*_RETENTION_*`-Variablen. `Dockerfile:31` exponiert fest `3001`,
obwohl `PORT` konfigurierbar ist.

### E10 [S3] Body-Limit 100 MB bei 5 MB Upload-Grenze
`index.js:94-95`: `express.json({ limit: '100mb' })` und dasselbe für
`urlencoded`. Das Foto-Limit ist 5 MB. Ein 100-MB-JSON-Body wird vollständig im
RAM geparst.

### E11 [S3] Unbekannte API-Routen antworten mit HTML
`index.js:226` fängt per `app.get(/^\/(?!api\/).*/)` alles außer `/api/` für die
SPA ab. Ein Tippfehler in einem API-Pfad landet im Express-Default-404 →
**HTML** statt JSON. Ein Client, der `res.json()` aufruft, bekommt einen
Parser-Fehler statt einer verwertbaren Meldung.

### E12 [S3] Fehlgeschlagene Testartefakte sind eingecheckt — *verifiziert*
`git ls-files e2e/` zeigt:
- `e2e/test-results/.last-run.json` — Inhalt: `{"status": "failed", …}`
- `e2e/test-results/auth-Login-…/error-context.md` — Fehlerbericht zu
  `auth.spec.js:44`, „Cannot navigate to invalid URL: /login" (fehlende
  `baseURL`; `playwright.config.ts:29` liest `process.env.BASE_URL` ohne
  Default)
- `e2e/.auth/user.json` — gespeicherter Session-State

Die getestete Datei `e2e/auth.spec.js` existiert **nicht mehr** — das Artefakt
beschreibt einen Test, den es nicht gibt. `.gitignore` listet
`/e2e/test-results/` und `/e2e/.auth/`, greift aber nicht: bereits getrackte
Dateien ignoriert Git nicht (`git rm --cached` nötig).

### E13 [S3] `playwright` als Produktions-`dependency`
Root-`package.json` führt `playwright` und `playwright-core` unter
`dependencies` (nicht `devDependencies`), zusätzlich zu `@playwright/test`
unter `devDependencies`. `undici-types` steht ebenfalls unter `dependencies`,
obwohl es ein reines Typenpaket ist.

### E14 [S3] `graphify-out/` ist eine nicht erfüllbare Projektregel
`CLAUDE.md` verlangt, vor **jeder** Projektfrage `/graphify` aufzurufen, weil
„Graphify data is stored in this project (`graphify-out/`)". Das Verzeichnis
existiert nicht und steht in `.gitignore`. Für jeden frischen Clone und jede
CI-/Agent-Session ist die Regel unerfüllbar.

---

# F. Der `whereClauseBuilder`

### F1 [S2] `build()` / `buildConditions()` sind nicht idempotent — *verifiziert*
`whereClauseBuilder.js:250-260`: beide Methoden rufen `_addTenantFilter()`, das
`this.conditions` und `this.params` **mutiert**.

*Fehlerszenario:* Das übliche Muster „ein Builder, zwei Queries" (Count +
Daten) ruft `build()` zweimal. Beim zweiten Aufruf steht die Tenant-Bedingung
doppelt drin, `paramIdx` ist weitergezählt, und die `$n`-Nummern passen nicht
mehr zu `getParams()` → falsche Filterung oder
`bind message supplies N parameters`. Aktuell latent, weil `tenantId` überall
`null` ist (vgl. B20).

### F2 [S2] `raw()` zählt Parameter, schreibt sie aber nicht — *verifiziert*
`whereClauseBuilder.js:240-247`: `raw(condition, ...paramValues)` erhöht
`paramIdx` pro Wert, die `$n`-Platzhalter muss der Aufrufer aber **selbst** in
den Bedingungstext schreiben. Ein Zahlendreher wird nicht erkannt und führt zu
einer syntaktisch gültigen Query mit **falschem Filter** — der gefährlichste
Fehlertyp, weil das Ergebnis plausibel aussieht.

### F3 [S2] Spaltennamen werden unvalidiert interpoliert
`whereClauseBuilder.js:208`, `220`, `231`:
`` `"${spalte}" = $${this.paramIdx}` ``. Unabhängig von der Sicherheitsfrage
ein Robustheitsproblem: ein Tippfehler im Spaltennamen erzeugt eine kaputte
Query erst zur Laufzeit, nicht beim Review. Eine Allowlist der erlaubten
Spalten wäre die naheliegende Absicherung.

### F4 [S3] `nichtVerkauft()` prüft `Ausschuss` nicht
`whereClauseBuilder.js:35-38` setzt nur `"Verkauft" = 0`, während `verkauft()`
(`:30`) korrekt `"Verkauft" = 1 AND "Ausschuss" = 0` verlangt.
`nichtVerkauft()` liefert damit auch Ausschussstücke — die Methode ist
entweder falsch oder falsch benannt.

### F5 [S2] Die zentrale Regel wird an 20+ Stellen umgangen
`CLAUDE.md` fordert den Builder für **alle** Schmuckstück-Queries. Handgeschriebenes
WHERE findet sich in:
- `lieferscheine.js:141`, `185`, `269`, `275`, `369`, `376`, `382`, `421`
- `rechnungen.js:140`, `185`, `302`, `308`, `414`, `421`, `427`, `466`
- `lagerinventur.js:245` — exakt `verfuegbar()`, von Hand geschrieben
- `inventur.js:49-53` — Status-CASEs von Hand (siehe C19)
- `etiketten.js:103`
- `schmuckstuecke.js:1027`, `1135`, `1147`, `1161`, `1350`, `1431`

Konsequenz: die zentrale Statuslogik existiert doppelt. Bei einer
Mapping-Änderung müssen 20+ Stellen nachgezogen werden — genau das, was die
Regel verhindern soll. **C19 ist der Beweis, dass es schon passiert ist.**

---

# G. Frontend (React)

### G1 [S1] `TablePhoto` ist innerhalb der Komponente definiert — alle Thumbnails verschwinden — *verifiziert*
```
frontend/src/pages/Schmuckstuecke.jsx:534    function TablePhoto({ … }) {   ← eingerückt = INNERHALB von Schmuckstuecke
frontend/src/pages/Inventur.jsx:58         function TablePhoto({ … }) {   ← Modulebene, korrekt
```
Eine im Render-Body deklarierte Komponente ist bei **jedem** Parent-Render ein
neuer Komponententyp. React unmountet und remountet daher den gesamten
Foto-Teilbaum, und `photoSrc` fällt auf `null`.

*Fehlerszenario:* Jeder Tastendruck in der Suche setzt alle Thumbnails zurück.
Beim Öffnen eines Modals ist zusätzlich `pauseLoading={isForegroundModalOpen}`
(`:739`) true → der Effekt lädt nicht neu → **alle** Bilder werden zu
Platzhaltern.

Dieselbe Komponente liegt in `Inventur.jsx` korrekt auf Modulebene — also
zugleich eine Dublette (≈77 nahezu identische Zeilen) in zwei
Qualitätsstufen.

### G2 [S2] Reload auf einer Unterseite wirft auf das Dashboard — *verifiziert*
`frontend/src/App.jsx:183-191`:
```jsx
if (!user) {
  return (<Routes> … <Route path="*" element={<Navigate to="/login" replace />} /></Routes>);
}
```
`AuthContext.jsx:22` hält einen `loading`-State und `:80` exportiert ihn — er
wird hier aber **nicht** geprüft. Während `/auth/me` läuft, ist `user === null`
→ F5 auf `/inventur` ersetzt die URL sofort durch `/login`, danach greift
`App.jsx:673` und leitet auf `/` um. Deep-Links sind nicht benutzbar, und die
Login-Seite blitzt bei jedem Reload auf. Der Spinner in
`ProtectedRoute.jsx:7-14` wird nie erreicht.

### G3 [S2] Dreifaches „Fassung"-Feld, zwei gleiche `datalist`-IDs — *verifiziert*
`frontend/src/pages/Schmuckstuecke.jsx`:
```
:1469  list="fassungen-list"   :1471  value={form.Fassung || ""}          ← Hauptstück
:1476  <datalist id="fassungen-list">
:1570  value={form.Anhänger_Fassung || ""}                                ← korrektes Anhänger-Feld
:1729  list="fassungen-list"   :1731  value={form.Fassung || ""}          ← im Anhänger-Block, bindet Hauptstück!
:1736  <datalist id="fassungen-list">                                     ← doppelte DOM-ID
```
Wer im Anhänger-Abschnitt eine Fassung einträgt, **überschreibt die Fassung des
Hauptstücks**. Dazu ist `id="fassungen-list"` zweimal im DOM — ungültiges HTML,
und `list=` bindet immer an das erste Vorkommen.

### G4 [S1] Kein Doppel-Submit-Schutz an drei Speicherpfaden
- `Schmuckstuecke.jsx:1884`/`1889`/`1896` — „Speichern + Schließen" /
  „Speichern + Weiter" / „Speichern": `handleSave` (`:144-176`) hat **keinen**
  `saving`-State. Zweiklick → 2× POST mit derselben
  `nextArtikelnummerPreview`: sequenziell entstehen zwei Datensätze, parallel
  ein PK-Konflikt mit rohem DB-Fehler im `alert`.
- `DocumentManager.jsx:1062-1070` — „Als Entwurf speichern" / „Speichern &
  Abschließen" ohne `disabled`. Die `Nummer` wurde vorher per `getNextNumber`
  (`:146-155`) geholt → zwei Rechnungen mit **identischer Nummer** bzw.
  PK-Verletzung.
- `Bestelluebersicht.jsx:473-479` — `disabled` prüft nur die
  Consent-Checkbox, nicht den laufenden Request → zwei Bestellungen.

### G5 [S1] Stale Closure: „Neue Rechnung" feuert zuverlässig einen 500er
`DocumentManager.jsx:135-143` liest `form` aus dem Render-Scope:
```js
const resp = await api.getPieces(pieceFilter(form, editing));
```
`openNew` (`:146-168`) ruft `setForm({… Kundennummer: "" })` und direkt danach
`loadAvailablePieces()` — mit dem **alten** `form`. `Rechnungen.jsx:41` baut
daraus `{ ausgelagert: "" }` → gesendet wird `ausgelagert=` → Backend
`schmuckstuecke.js:758`: `builder.equals("Ausgelagert", parseInt(""))` →
Parameter `NaN` → `invalid input syntax for type integer: "NaN"` → 500 →
`alert(…)`. Das ist genau der in C25 beschriebene fehlende NaN-Guard, hier vom
Frontend zuverlässig getroffen.

In `openEditDraft` (`:40-58`) dasselbe, und zusätzlich lädt der `useEffect`
(`:171-185`) nur bei `editing === "new"` nach — ein Entwurf bekommt die
richtige Stückliste also nie.

### G6 [S1] Ausgewählte Positionen verschwinden aus der Liste, werden aber gespeichert
`DocumentManager.jsx:980-984`:
```js
const piece = availablePieces.find((p) => p.Artikelnummer === nr);
if (!piece) return null;
```
Die Überschrift zeigt `form.Artikelnummern.length` (`:932`), die Tabelle
rendert nur Treffer aus `availablePieces`. Nach G5 ist `availablePieces` leer →
„Ausgewählte Schmuckstücke (7)" über einer **leeren** Tabelle. Speichern
schreibt die sieben unsichtbaren Positionen trotzdem.

### G7 [S1] Die Auszahlungsaufteilung ignoriert alle Rabatte
`DocumentManager.jsx:625-657`: `totalBrutto`, `marinaBrutto`, `saskiaBrutto`
summieren `s.Verkaufspreis` roh. `rabatt_gesamt` und `rabatt_positionen` werden
nur **angezeigt** (`:592-598`, `:771-806`), gehen aber nicht in die
Provisions-/Auszahlungsrechnung ein. Bei 20 % Gesamtrabatt zeigt das Modal
einen um 20 % zu hohen Auszahlungsbetrag pro Herstellerin — die Zahl, nach der
abgerechnet wird. Passt zu C18 (Dashboard) und C17 (Excel): derselbe Fehler an
drei Stellen.

### G8 [S2] Race Condition in der Liste: ein Request pro Tastenanschlag
`Schmuckstuecke.jsx:123-130` + `:417-419`:
```js
const load = () => { setLoading(true); api.getSchmuckstuecke({page, limit:50, search, ...filters}).then(setData)… };
useEffect(() => { load(); }, [page, search, filters]);
```
Kein Debounce (`TableToolbar.jsx:15` gibt jeden Keystroke direkt weiter), kein
`AbortController`, kein `ignore`-Flag, `load` fehlt im Dep-Array. Bei „Ring"
vier Requests; antwortet Request 2 nach Request 4, überschreibt `setData` das
Ergebnis mit alten Treffern. Und das `finally` des ersten Requests setzt
`loading=false`, während der letzte noch läuft → veraltete Tabelle ohne
Spinner.

`Etiketten.jsx:77-100` macht genau dasselbe **richtig** (Debounce + Abort) —
dieselbe Aufgabe, zwei Qualitätsniveaus.

### G9 [S1] Duplizieren verwirft die Eingaben und holt das Foto zurück
`Schmuckstuecke.jsx:383-410` setzt `Artikelnummer` auf die 6-stellige Basis und
bewusst `Foto: ""`. Der Preview-Effekt (`:429-437`) verlangt `/^[A-Z]{3}$/` →
kein Match → `nextArtikelnummerPreview` bleibt leer. Zwei Folgen:
- `PhotoUpload` ist wegen
  `disabled={editing === "new" && !nextArtikelnummerPreview}` (`:1412`)
  gesperrt, mit der irreführenden Meldung „Bitte zuerst Hersteller,
  Grundmaterial und Produktart auswählen" (`PhotoUpload.jsx:141-143`), obwohl
  alle drei gesetzt sind.
- `handleSave` sendet die Basisnummer → Backend trifft den Kopier-Block
  (C11) und **überschreibt Name, Art, Farbe, Verkaufspreis und Foto mit der
  Vorgänger-Variante**. Alles, was der Nutzer im Duplikat geändert hat, landet
  nicht in der DB.

### G10 [S1] Wunschdatum verschiebt sich pro Bearbeitung um einen Tag
`Bestelluebersicht.jsx:73` (`b.wunschdatum.slice(0,10)`) vs. `:254`
(`new Date(r.wunschdatum).toLocaleDateString("de-DE")`). `wunschdatum` ist
`DATE` (`init.sql:378`) und kommt als `Date` zurück → JSON ist UTC.

*Fehlerszenario:* Backend mit `TZ=Europe/Berlin` (nativer `npm run dev`,
Synology-Deployment; in den Compose-Dateien ist **kein** TZ gesetzt, Container
laufen UTC): aus dem 25.09. wird `2026-09-24T22:00:00Z`. Die Tabelle zeigt
25.09., das Bearbeiten-Modal 24.09., Speichern persistiert den 24.09. Jede
Bearbeitung schiebt einen Tag zurück, bis `bestellung_wunschdatum_check`
(`init.sql:387`) zuschlägt. Gleiche Klasse: `Inventur.jsx:47-56`,
`DocumentManager.jsx:462`/`499`/`585`. Direkte Folge von B13.

### G11 [S2] State-Mutation im Render
`DocumentManager.jsx:763-768`: `detail.schmuckstuecke.sort(...)` sortiert das
Array **in place** im State-Objekt (kein `[...]`). Unter React 19 StrictMode
(Doppel-Render) ändert sich die Reihenfolge unter der Hand.

### G12 [S2] Stale State: `setState(wert)` statt Updater bei abhängigen Updates
`DocumentManager.jsx:208-222` (`togglePiece` liest `form` aus der Closure),
`:224-241`, `:962-967`, `:1004-1013`, `:1046-1049`;
`Schmuckstuecke.jsx:1228-1232`, `:1254-1258`, `:1280-1284` (drei Selects, die
sich gegenseitig die Artikelnummer neu berechnen), `:1414-1416`. Zwei Events im
selben Tick → die erste Änderung fällt weg. Der korrekte Updater-Stil existiert
daneben (`Bestelluebersicht.jsx:101`, `Etiketten.jsx:138`).

### G13 [S2] Sortieren sortiert nur die aktuelle Seite; eine Spalte sortiert gar nicht
Der Server paginiert mit `limit: 50` (`Schmuckstuecke.jsx:126`), `DataTable`
sortiert **clientseitig** (`DataTable.jsx:17-42`). Klick auf „Preis" sortiert 50
von z. B. 1.200 Stücken — der Nutzer glaubt, das teuerste Stück zu sehen.

Dazu ist `{ key: "Status", sortable: true }` (`:797-799`) deklariert, aber das
Backend liefert **kein** Feld `Status` → `row["Status"] === undefined` für alle
Zeilen → der Header-Klick tut sichtbar nichts.

### G14 [S3] Drei Seiten schleppen eine zweite, tote Sortier-Implementierung mit
`Schmuckstuecke.jsx:101-104` (`setSortConfig` wird **nie** aufgerufen),
`Inventur.jsx:1524-1527` + `requestSort`/`getSortIcon` (`:1594-1605`, nie
übergeben), `DocumentManager.jsx:31-34` + `:297-308`. Jede Liste wird dadurch
zweimal sortiert, und die toten Spezialfälle suggerieren Features, die es nicht
gibt. Ebenso tot: `Inventur.jsx:1850-1899` `InlineItems` (nirgends gerendert).

### G15 [S2] Fußzeilen widersprechen der gefilterten Tabelle
`Inventur.jsx:1607-1628` summiert über `summary` (alle Kunden), die Tabelle
zeigt `sorted` aus `filtered` (`:1549-1566`). Filter „Inaktiv" → eine Zeile mit
3 Stücken, Fußzeile „Gesamt 412". Gleiche Klasse: `DocumentManager.jsx:343`,
`Bestelluebersicht.jsx:196`.

### G16 [S2] Endlos-Polling ohne Abbruchbedingung
`Datensicherung.jsx:180-206`: `while (true)` pollt alle 500 ms
`getBackupUploadsExportJob`; Ausstieg nur bei `completed`/`failed`. Bleibt der
Job hängen oder verlässt der Nutzer die Seite (`isMountedRef` schützt nur
`setState`, nicht die Schleife), laufen 2 Requests/Sekunde bis zum Tab-Ende
weiter.

### G17 [S2] Zahl im Inventur-Editor löschen entfernt die Position
`Inventur.jsx:1192-1203`: `if (isNaN(val) || val <= 0) delete nextData[nr]`.
Wer „1" markiert und „12" tippen will, löscht mit dem ersten Tastendruck die
Zeile samt Fokus — und der Autosave (`:1171-1177`) schreibt das 800 ms später
ins Backend.

### G18 [S3] `setTimeout` ohne Cleanup steuert den Autosave-Start
`Inventur.jsx:1111`: `setTimeout(() => setDraftLoaded(true), 100)` — kein
`clearTimeout` im Effekt-Cleanup (Deps `[draftId, onBack]`, `:1134`).
Draft-Wechsel innerhalb 100 ms → `draftLoaded=true` für den **falschen** Draft,
und der Autosave schreibt den alten `draft`-State.

### G19 [S2] 68× `alert()` statt UI-Fehlerstate
`Inventur.jsx` 20, `Schmuckstuecke.jsx` 16, `DocumentManager.jsx` 12,
`Benutzerverwaltung.jsx` 9, weitere 11. `Schmuckstuecke.jsx:128` feuert
`alert("Fehler beim Laden der Schmuckstücke: " + err.message)` bei **jedem**
Tastendruck-Request (G8) — zwei parallele Fehler ergeben zwei blockierende
Dialoge hintereinander.

### G20 [S2] Verschluckte Fehler — und `CLAUDE.md` behauptet das Gegenteil
- `Dashboard.jsx:81` `.catch(() => setError(true))` — die Meldung wird
  weggeworfen.
- `Bestelluebersicht.jsx:96` `.catch(() => setFotoDataUrl(null))` — Foto fehlt
  ohne Hinweis.
- `SchmuckstueckDetail.jsx:41` und `Benutzerverwaltung.jsx:70`
  `.catch(console.error)`.
- `api.js:34` `.catch(() => null)` beim CSRF-Token: schlägt `/csrf-token` fehl,
  gehen **alle** folgenden POST/PUT/DELETE ohne Header raus und scheitern mit
  403 — die Ursache steht nur in der Konsole.

`CLAUDE.md:291` behauptet, genau diese `.catch(console.error)`-Fälle seien
ersetzt worden. Sie sind es nicht.

### G21 [S2] Preisformatierung: vier verschiedene Wahrheiten, keine deutsch
- `Schmuckstuecke.jsx:794`: `` `${r.Verkaufspreis}€` `` → `12.5€` (Punkt, keine
  zwei Dezimalstellen).
- `DocumentManager.jsx:793`/`796`/`800`/`914`: `.toFixed(0)` → 12,50 € wird als
  `13€` gezeigt, und die Summe der angezeigten Positionen passt nicht zum
  Gesamtwert (`:678`, `.toFixed(2)`).
- `Dashboard.jsx:229` `.toFixed(0)`, `:322`/`:395` `.toFixed(2)` — Punkt.
- Nur `Inventur.jsx:29-34` macht es korrekt
  (`toLocaleString("de-DE", {style:"currency"})`) — und diese Funktion ist
  nirgends geteilt.

### G22 [S2] Statuslogik dreifach im Frontend, Konstanten vierfach
- Status: `Schmuckstuecke.jsx:800-809` (Lager = `badge gold`),
  `SchmuckstueckModal.jsx:86-101` (Lager = `badge warning`),
  `Inventur.jsx:349-357`/`1873-1877` — bei **abweichenden Badges** für
  denselben Zustand. Die verbindliche Definition soll laut `CLAUDE.md:131-136`
  im `whereClauseBuilder` liegen.
- Konstanten: `GRUNDMATERIAL` in `Schmuckstuecke.jsx:30-48` = 
  `backend/src/utils/constants.js:4-21`. `PRODUKTART` in
  `Schmuckstuecke.jsx:50-55`, **nochmals** hartcodiert im Filter-Dropdown
  `Schmuckstuecke.jsx:672-677`, in `constants.js:24-29` und erneut in
  `backend/src/routes/schmuckstuecke.js:90-95` — **vier** Kopien. Verstößt
  direkt gegen `CLAUDE.md:104` („Merge duplicates").

### G23 [S3] Doppelte Berechnung, ungenutzte Backend-Felder
`Dashboard.jsx:126-142` rechnet `Number(((value / totalStatusValue) * 100).toFixed(1))`
— identische Formel liefert das Backend schon mit
(`dashboard.js:245-252`, Feld `percentage`). Umgekehrt wird
`data.recentChanges` vom Backend geliefert und im Frontend **nie** benutzt.
`Inventur.jsx:157-161` und `:455-457` rechnen Summen parallel zu
`data.stats.wert_aktiv`/`wert_verkauft`.

### G24 [S3] `DataTable`: Props-abgeleiteter State ohne Sync, nutzloses Memo, riskanter Default-Key
`DataTable.jsx:13` `useState(defaultSort)` — späteres Ändern von `defaultSort`
wirkt nie (z. B. beim Tab-Wechsel in `Inventur.jsx:169`, wo die Datumsspalte
ihre Bedeutung wechselt, die Sortierung aber stehen bleibt). `:42` hat `columns`
als Dep, das bei jedem Parent-Render ein neues Array ist → das `useMemo` rechnet
immer neu. `:10` `getRowKey = (r) => r.id || r.ID || JSON.stringify(r)` — der
JSON-Fallback ändert sich bei **jeder** Feldänderung → Row-Remount samt
Fokusverlust in Zell-Inputs.

### G25 [S3] `api.js`: Header-Merge ist kaputt (latent)
`api.js:57`:
```js
const res = await fetch(`${API_URL}${url}`, { credentials: 'include', headers, ...options });
```
`...options` steht **nach** `headers` — sobald ein Aufrufer `options.headers`
setzt, überschreibt der Spread die in Zeile 46 zusammengebauten Header und
verwirft `Content-Type` **und** `X-CSRF-Token`. Heute ruft niemand so auf, die
Falle ist aber scharf.

### G26 [S2] `loadPhotoAsDataUrl` nimmt ein `signal` an und benutzt es nie
`api.js:294-330` (dokumentiert in `:202-203`). `PhotoUpload.jsx:18`/`22`/`42`
und beide `TablePhoto`-Kopien bauen `AbortController`, die den Request nicht
abbrechen — das Cleanup ist kosmetisch. Zusammen mit G1: N laufende
Foto-Requests pro Tabellen-Render, bei `FOTO_CACHE_MAX = 400` Data-URLs
(`api.js:179`) potenziell dreistellige MB im Speicher. Das ist die
Frontend-Seite der Pool-Erschöpfung aus B14.

### G27 [S3] Weitere fehlende Dep-Arrays und Foto-Races
`Schmuckstuecke.jsx:417-419`, `:466-487` (dazu erzeugt
`navigate(location.pathname, {state:{}})` bei jedem Lauf eine neue
State-Identität → der Effekt läuft erneut); `DocumentManager.jsx:92-95`,
`:171-185`; `Inventur.jsx:337-344`, `:692-698`, `:1433-1437`;
`SchmuckstueckModal.jsx:35-47` (ruft `onClose()` aus dem `catch`), `:49-66`;
`Bestelluebersicht.jsx:92-97` (Bestellung A geöffnet, dann B → As Foto kann
bei B landen).

### G28 [S3] Kleinere Umsetzungsfehler
- `Etiketten.jsx:85` lädt mit `limit: "200"`, `:346` zeigt
  `{options.length} Treffer` → bei 900 passenden Artikeln steht „200 Treffer".
  `importCsvFile` (`:194-219`) übernimmt ungeprüfte Artikelnummern in die
  Druckliste, ohne Abgleich mit `options`.
- `Sumup.jsx:100-117`/`150-163`: `<ul>` mit `<div>`-Kindern statt `<li>`.
  `:215` koppelt die Hilfe-Box an `sumupError.includes("Spalten")`, also an den
  deutschen Wortlaut einer Backend-Meldung. `:249` verweist auf
  Debug-Ausgaben, die im Import-Pfad (`:27-52`) nie erzeugt werden. Die vom
  Backend gelieferten `details` werden nie angezeigt.
- `DocumentManager.jsx:414-478`: eigene Tabelle ohne Status-Spalte,
  `<th style={{cursor:"pointer"}}>` **ohne** `onClick` (sieht sortierbar aus,
  ist es nicht), und `<td colSpan={4}>` (`:434`) bei drei Spalten.
- `Dashboard.jsx:750`/`759`/`768`: `className={… ? "btn" : "btn-secondary"}` —
  ohne Basisklasse `btn` sind die inaktiven Umschalter unformatiert (korrektes
  Muster: `Etiketten.jsx:602`).
- `Datensicherung.jsx:526`: die **komplette Seite** steckt in
  `<div className="page-header">`. `:640`: bei `totalBytes === null` steht
  „12,3 MB von 0 B geladen".
- `Schmuckstuecke.jsx:1405`: `<h4>� Foto</h4>` — U+FFFD, einziges Vorkommen
  im Projekt.
- `Schmuckstuecke.jsx:495`: `console.log("🔍 Bestimme Längeneinheit …")` im
  Render-Pfad, ausgelöst bei jedem Tastendruck im Modal. `CLAUDE.md:105`
  verbietet genau das.
- `Schmuckstuecke.jsx:752`: `{parts[1] > 0 && …}` vergleicht String mit Zahl →
  bei nicht-numerischem Suffix verschwindet das Badge lautlos. `:1304`
  `parseInt(e.target.value) || 1` ohne Radix; Eingabe „0" wird stumm zu 1.
- `Rechnungen.jsx:41`/`Lieferscheine.jsx:41`: `limit: -1` lädt **alle**
  verfügbaren Stücke unvirtualisiert in ein Modal — und erzeugt dabei die
  negativen `totalPages` aus C25.
- `AuthContext.jsx:44-53`: `login()` setzt `sessionStorage` nur bei
  `mustChange === true`, entfernt es aber nie bei `false`. Bleibt der Eintrag
  im Tab stehen, stellt der Mount-Effekt (`:32-34`) die Passwortpflicht wieder
  her — und `App.jsx:141-146` lässt das Modal dann nicht mehr schließen.
- Ungenutzte Importe in `App.jsx:19` (`faTag` — der `/etiketten`-Link fehlt in
  `navGroups`, die Route ist nur über einen Tab erreichbar), `Rechnungen.jsx:1`
  und `Lieferscheine.jsx:1`. `no-unused-vars` ist in
  `frontend/eslint.config.js:27` als **error** gesetzt, der
  `varsIgnorePattern: '^[A-Z_]'` greift bei Kleinbuchstaben-Namen nicht — d. h.
  `npm run lint` sollte hier rot sein. *(In dieser Umgebung nicht nachprüfbar:
  es sind keine `node_modules` installiert. Aber E5 zeigt, dass die CI
  Frontend-Lint ohnehin nie aufruft.)*

---

# TEIL 2 — Reparaturplan

Sortiert nach Wirkung pro Aufwand. Die erste Gruppe ist ein Nachmittag.

## Gruppe 1 — Minuten bis Stunden, große Wirkung

| # | Befund | Maßnahme |
|---|---|---|
| A0 | Seed kaputt | `"Online"` in `init.sql`+`db.js` nachziehen **oder** `seed.sql` neu generieren |
| A7 | Seed meldet falschen Erfolg | `psql -v ON_ERROR_STOP=1 --single-transaction` in `load_seed.sh` |
| A1 | Server startet vor Migration | `app.listen()` in den `.then()` der Kette; `initializeDatabase()` exportieren und in `index.js` awaiten |
| A2 | Migrationsfehler geschluckt | `catch` → `logger.error` **+ `process.exit(1)`** |
| A3 | Health lügt | Health-Endpoint erst `ok`, wenn die Migration durch ist; `HEALTHCHECK` in `Dockerfile` + Compose |
| E1 | Fotoverlust | Named Volume für `uploads` in `docker-compose.yml` |
| B4 | `Rechnung."ID"` | `ADD CONSTRAINT rechnung_id_key UNIQUE ("ID")`, `DROP INDEX idx_rechnung_id` |
| B11 | Audit-Indizes | `idx_audit_ts`, `idx_audit_artikel`, `idx_lieferschein_kundennummer`, `Datum`-Indizes |
| D1/D2 | Preis wird NULL | `parseFloat(…) \|\| 0` an allen 5 Stellen; `.replace(',', '.')` in `zahl()` (`common.js:26`) |
| C26/C27 | Debug-Rückstand | `String(err)`/`details: err.message` entfernen; `logger.error` in `lagerinventur.js` |
| E5 | CI prüft zu wenig | `npm test -- --coverage`, Frontend-Lint-Step, E2E-Workflow |
| E12 | Testmüll eingecheckt | `git rm --cached -r e2e/test-results e2e/.auth` |
| E7 | Build nicht reproduzierbar | `npm ci` / `npm ci --omit=dev` im `Dockerfile` |
| E9 | `PORT` ohne Default | `${PORT:-3001}` in `docker-compose.yml` |
| G1 | Thumbnails verschwinden | `TablePhoto` aus `Schmuckstuecke.jsx` auf Modulebene ziehen (oder die Kopie aus `Inventur.jsx` teilen) |
| G2 | Deep-Links kaputt | `loading` aus `useAuth()` im Guard `App.jsx:183` prüfen |
| G3 | Fassung überschreibt sich | `Schmuckstuecke.jsx:1731` auf `form.Anhänger_Fassung`, doppelte `datalist`-ID entfernen |
| G4 | Doppel-Submit | `saving`-State + `disabled` an allen drei Speicherpfaden |
| G5/G6 | „Neue Rechnung" 500er | `loadAvailablePieces(nextForm)` explizit parametrisieren statt `form` aus der Closure |
| G13 | Spalte „Status" sortiert nicht | `sortable: false` setzen oder das Feld serverseitig liefern |
| G28 | `<h4>� Foto</h4>` | U+FFFD in `Schmuckstuecke.jsx:1405` ersetzen |

## Gruppe 2 — ein bis drei Tage

1. **Transaktionen nachziehen** (C1–C4): `db.connect()` + `BEGIN`/`COMMIT`/
   `ROLLBACK` in beiden PUTs und beiden DELETEs, und `BEGIN` in `sumup.js`
   **vor** den Kunden-INSERT ziehen. Muster ist schon im Repo:
   `backup.js:711-713`.
2. **Geld auf `numeric(10,2)`** (B1) inklusive Entfernen der
   `::DOUBLE PRECISION`-Casts und der `Number()`-Aufrufe außer an der
   Anzeigekante.
3. **Statusfelder absichern** (B6, C8): `boolean NOT NULL` +
   `CHECK (NOT ("Verkauft" AND "Ausschuss"))`, und im PUT nur Felder schreiben,
   die im Request stehen (`COALESCE($n, "Spalte")` oder dynamisches SET).
4. **Artikelnummer an genau einer Stelle normalisieren** (D3, D4, D6): zod
   `.transform(s => s.toUpperCase())`, die 11 verstreuten `toUpperCase()`
   entfernen, `vollstaendigeArtikelnummer` überall verwenden, ein Format-Regex
   statt zwei.
5. **`/restock` korrigieren** (C7): `aktivAusgelagert()` statt `ausgelagert()`,
   `Lieferschein_ID` mit zurücksetzen.
6. **Kopier-Block reparieren** (C11): explizites Flag statt
   `if (b.Artikelnummer)`, oder ganz entfernen.
7. **Backup/Restore härten** (E2, E3, B18): Dump in Tempdatei + `gzip -t` +
   atomarer `mv`; `find -mtime` statt `ls | tail`; `gunzip -t`-Vorabtest und
   Rückfrage in `restore.sh`; `ALL_TABLES` aus dem Katalog ableiten.
8. **Sequences generisch resetten** (B17).
9. **Rabatte in Dashboard und Inventur einbeziehen** (C18), und die
   Positionssumme im Excel aus den echten Einzelpreisen bilden (C17).
10. **`tenant_id` entfernen** (B20, F1) — ungetesteter Blindcode, der bei
    Aktivierung das Dashboard zerlegt.
11. **Rabatte in die Auszahlungsaufteilung einbeziehen** (G7) — derselbe Fehler
    wie C17/C18, an der Stelle, nach der tatsächlich abgerechnet wird.
12. **Eine Geld-Formatierung für alles** (G21): `formatEuro()` aus
    `Inventur.jsx:29-34` in ein gemeinsames Modul ziehen und die vier anderen
    Varianten ersetzen.
13. **Konstanten und Statuslogik entdoppeln** (G22): `GRUNDMATERIAL`/
    `PRODUKTART` als einzige Quelle aus einem geteilten Modul (oder per
    API-Endpunkt), Status-Badge-Helper einmal.
14. **Debounce + `AbortController` in der Liste** (G8) — das Muster steht schon
    fertig in `Etiketten.jsx:77-100`.
15. **`alert()` ersetzen** (G19, G20): die vorhandenen Fehler-States nutzen,
    `.catch(() => …)` mit Meldung, `api.js:34` beim CSRF-Fehler laut scheitern
    lassen statt still.

## Gruppe 3 — Wochen, planbar

1. **Echtes Migrationstool** (A5): `node-pg-migrate` oder numerierte
   `.sql`-Dateien + `schema_migrations`. Jede Migration in **einer**
   Transaktion, `pg_advisory_lock` um die Kette, `init.sql` ersatzlos durch
   „Migration 0001" ersetzen.
2. **Referenzielle Integrität** (B2, B3): `Ausgelagert` → nullable FK
   `Ausgelagert_Kunde_ID`, dazu FKs für `Lieferschein_ID`/`Rechnung_ID` mit
   passendem `ON DELETE`. „Lager" und „Messe" aus der Kundentabelle lösen.
3. **`timestamptz` durchgängig** (B13), mit explizitem Quell-Offset pro Spalte.
4. **Primärschlüssel auf `ID` umstellen** (B5), Fachnummern zu `UNIQUE`.
5. **Audit-Trigger umbauen** (B12): eine `jsonb`-Zeile statt sechs INSERTs,
   `FOR EACH STATEMENT` mit `REFERENCING NEW TABLE`, INSERT/DELETE mit
   protokollieren, `BEFORE TRUNCATE`-Schutz, monatliche Partitionierung.
6. **Merkmale normalisieren** (B10) und `snake_case`/ASCII-Bezeichner (B22),
   abwärtskompatibel per View + `INSTEAD OF`-Trigger.
7. **Pool-Modell korrigieren** (B14): Client pro Transaktion statt pro Request;
   Foto-Endpunkt ohne DB-Client bedienen.

## Verifikation

Nach Gruppe 1:
```bash
# 1. Frische Installation muss durchlaufen (prüft A0, A7)
docker compose down -v && docker compose up --build -d
docker compose logs db  | grep -i "error\|does not exist"   # muss leer sein
docker compose logs app | grep -i "Fehler beim Verifizieren" # muss leer sein

# 2. Datenbestand muss angekommen sein
docker compose exec db psql -U goldregen -d goldregendb \
  -c 'SELECT count(*) FROM "Schmuckstück";'   # muss > 0 sein

# 3. Fotos müssen einen Container-Neustart überleben (prüft E1)
#    Foto hochladen, dann:
docker compose up --build -d --force-recreate app
docker compose exec app ls /app/src/assets/uploads   # Datei muss noch da sein

# 4. Tests mit Coverage (prüft E5)
cd backend  && npm run lint && npm run typecheck && npm test -- --coverage
cd frontend && npm run lint && npm test

# 5. Preisfeld leeren darf kein NULL erzeugen (prüft D1/D2)
#    Im UI Preis leeren und "12,50" eintippen, danach:
docker compose exec db psql -U goldregen -d goldregendb \
  -c 'SELECT count(*) FROM "Schmuckstück" WHERE "Verkaufspreis" IS NULL;'  # muss 0 sein
```

Für die Transaktionen aus Gruppe 2 je einen Jest-Test, der die zweite Query
per `db.query`-Mock scheitern lässt und prüft, dass der erste Schritt
zurückgerollt wurde. Die Mock-Infrastruktur existiert schon
(`backend/__tests__/helpers/dbMock.js`).

---

# TEIL 3 — Best Practices für künftige Projekte

Die zehn Muster, die in diesem Projekt jeweils mehrfach zugeschlagen haben. Die
Reihenfolge ist die Reihenfolge, in der sie Geld kosten.

### 1. Die Datenbank ist die letzte Verteidigungslinie, nicht die erste Ablage
Jede Regel, die nur im Anwendungscode steht, wird durch Import, Skript, psql
oder den nächsten Entwickler umgangen. Dieses Projekt hat für die Statuslogik
**eine** CHECK-Constraint, und die ist `NOT VALID`.

Faustregel: **Wenn ein Zustand fachlich unmöglich ist, muss die Datenbank ihn
ablehnen.** `NOT NULL`, `CHECK`, `UNIQUE`, `FOREIGN KEY` sind kein
Zusatzaufwand, sie sind die Spezifikation in ausführbarer Form. Die Constraint,
die heute drei Minuten kostet, ersetzt morgen eine Woche Datenarchäologie.

### 2. Geld ist `numeric`, nie `float`
`DOUBLE PRECISION` kann `0.1` nicht darstellen. Das fällt bei einem Artikel
nicht auf und bei 400 Rechnungspositionen schon. In Postgres `numeric(10,2)`,
in Python `Decimal`, in C# `decimal`. In JavaScript: als String transportieren
und nur zur Anzeige in `Number` wandeln — `pg` liefert `numeric` genau deshalb
als String.

Dasselbe gilt für alles Gezählte, das exakt sein muss: Prozente, Gewichte,
Maße in Rechnungen.

### 3. `NULL` ist das Sentinel, nicht `0`
`Ausgelagert = 0` für „nicht ausgelagert" hat hier drei Folgeschäden erzeugt:
kein Fremdschlüssel möglich, Semantik-Overloading (Flag **und** FK in einer
Spalte), und schließlich einen echten Kunden mit `ID = 0`, der die Bedeutung
endgültig zerstört hat.

Faustregel: **Eine Spalte hat eine Bedeutung.** „Kein Bezug" ist `NULL`. Wenn
du einen Magic Value brauchst, brauchst du eigentlich zwei Spalten oder eine
zusätzliche Tabelle.

### 4. Ein logischer Schreibvorgang ist eine Transaktion
„Kopf schreiben, dann Positionen" sind zwei Statements und ein Geschäftsvorfall.
Ohne `BEGIN`/`COMMIT` ist der Zustand nach einem Teilfehler unbestimmt — und
gerade Storno-Logik („erst alles zurücksetzen, dann neu setzen") hinterlässt
beim Abbruch den **schlimmstmöglichen** Zustand: alles zurückgesetzt, nichts
neu gesetzt.

Faustregel: **Wenn zwei `UPDATE` zusammen einen Vorgang ergeben, gehören sie in
eine Transaktion.** In diesem Projekt hatten die POST-Routen `BEGIN`, die PUT-
und DELETE-Routen nicht — ein Zeichen, dass es nachgerüstet und nicht
durchdacht wurde.

### 5. Ein verschluckter Fehler ist teurer als ein Absturz
Das durchgehende Muster hier: `catch (err) { logger.error(...) }` und weiter.
Migrationen, Seed-Import, Backup-Rotation, Foto-Index. Überall wird ein Problem
in eine Logzeile verwandelt, die niemand liest — und das System meldet Erfolg.

Faustregel: **Beim Start hart abbrechen, im Betrieb den Request scheitern
lassen, und niemals „OK" melden, was nicht OK ist.** `process.exit(1)` bei
kaputtem Schema ist freundlicher als 500er, deren Ursache drei Wochen später
gesucht wird. Ein Skript, das `echo "✅ erfolgreich"` **unbedingt** ausführt,
ist schlimmer als gar keine Ausgabe.

### 6. Normalisiere an der Grenze, genau einmal
`toUpperCase()` steht hier an 11 Stellen in 4 Dateien — und trotzdem gibt es
Pfade, die es nicht tun. Ergebnis: derselbe Artikel kann zweimal existieren und
in Filtern unsichtbar sein.

Faustregel: **Jede Eingabe wird an genau einer Stelle in Normalform gebracht —
im Validierungsschema.** zod kann das mit `.transform()`. Danach darf sich
kein Code mehr darum kümmern, und die DB sichert es mit einem CHECK ab.

### 7. Validierung erlaubt nur, was das System auch verarbeiten kann
Die Artikelnummer-Regex hier erlaubt Kleinbuchstaben und Umlaute; die
Filterlogik findet nur Großbuchstaben, und die Materialtabelle kennt nur
17 ASCII-Buchstaben. Die Validierung lässt also Daten durch, mit denen das
System nichts anfangen kann — und `|| "Unbekannt"` verschiebt den Fehler nach
hinten, wo er teurer ist.

Faustregel: **Validierung, Datenmodell und Geschäftslogik müssen dasselbe
Alphabet sprechen.** Ein Wert, der nicht verarbeitet werden kann, wird beim
Eintritt abgelehnt — nicht später zu „Unbekannt" gemacht.

### 8. Eine Regel ohne Durchsetzung ist eine Lüge in der Dokumentation
`CLAUDE.md` verbietet Inline-Styles als „STRICT RULE" — es gibt 322. Sie
verlangt den `whereClauseBuilder` für alle Queries — 20+ Stellen umgehen ihn.
Sie verlangt `/graphify` — das Verzeichnis existiert nicht.

Faustregel: **Jede Konvention braucht einen Linter oder einen CI-Check, sonst
schreib sie nicht hin.** `react/forbid-dom-props` hätte alle 322 Fälle beim
ersten Commit gemeldet. Und was die CI nicht prüft, existiert nicht: die
`coverageThreshold` hier wird nie ausgewertet, das Frontend wird nie gelintet,
die E2E-Tests laufen nie.

### 9. Ein Backup, das nie zurückgespielt wurde, ist kein Backup
Hier: die Rotation kann sieben gute Backups durch sieben kaputte ersetzen, der
Restore löscht die Datenbank bevor er das Archiv prüft, und der Export lässt
drei Tabellen aus, weil die Liste handgepflegt ist.

Faustregeln:
- **Erst validieren, dann ersetzen.** Dump in eine Tempdatei, prüfen
  (`gzip -t`, Größe, Tabellenzahl), dann atomar `mv`.
- **Erst prüfen, dann zerstören.** Vor `DROP DATABASE` das Archiv testen und
  einen Sicherheits-Dump ziehen.
- **Listen von Tabellen/Spalten aus dem Katalog ableiten, nie pflegen.** Jede
  handgeschriebene Liste vergisst irgendwann einen Eintrag — hier die
  DSGVO-Tabellen im Backup und `lagerinventur` beim Sequence-Reset.
- **Restore-Test im Kalender**, nicht im Kopf.

### 10. Das Zustandsmodell an genau einer Stelle definieren — und diese Stelle benutzen
Der `whereClauseBuilder` ist die richtige Idee: eine Definition von
„verfügbar", „verkauft", „ausgelagert". Nur hat sie sich nicht durchgesetzt, und
`inventur.js:49-53` hat bereits eine **abweichende** Auslegung von „verkauft" —
genau die Doppelzählung, die der Builder verhindern sollte.

Faustregel: **Wenn du eine zentrale Abstraktion einführst, mach die Alternative
unmöglich**, nicht bloß unerwünscht. Ein Repository-Modul, das als Einziges
`db.query` auf die Tabelle darf; ein Lint-Check gegen `"Schmuckstück"` in
Route-Dateien; oder eine SQL-View `schmuckstueck_verfuegbar`, gegen die alle
abfragen. Am besten zusätzlich als CHECK/generierte Spalte in der DB (siehe 1).

### 11. Wenn du dasselbe Problem zum zweiten Mal löst, lösche die erste Lösung
Das ist das auffälligste Muster in diesem Projekt und der Grund, warum die
meisten Befunde oben Paare sind:

| richtig gelöst | falsch gelöst |
|---|---|
| `UNIQUE ("ID")` auf `Lieferschein` | fehlt auf `Rechnung` |
| `BEGIN` + `LOCK TABLE` in POST | fehlt in PUT und DELETE |
| `parseFloat(…) \|\| 0` (1 Stelle) | ohne Guard (5 Stellen) |
| `ROLLBACK` in try/catch (3 Dateien) | ungeschützt (1 Datei) |
| `TablePhoto` auf Modulebene (`Inventur`) | im Render-Body (`Schmuckstuecke`) |
| Debounce + Abort (`Etiketten`) | keines von beidem (`Schmuckstuecke`) |
| `_` escaped im LIKE (`etiketten.js`) | nicht escaped (`schmuckstuecke.js`) |
| `ON_ERROR_STOP=1` (`restore.sh`) | fehlt (`load_seed.sh`) |
| `nichtVerkauft().keinAusschuss()` (`sumup.js`) | nur `Verkauft=1` (`rechnungen.js`) |
| `toLocaleString("de-DE")` (`Inventur`) | vier andere Varianten |

Das Wissen war jedes Mal da. Was fehlte, war der Schritt danach: **die gute
Lösung an eine Stelle ziehen und die Alternative unmöglich machen.** Konkret —
ein geteiltes `formatEuro()` statt vier Formatierungen, eine
`TablePhoto`-Komponente statt zwei, ein Repository-Modul, das als Einziges
`BEGIN` kennt.

Faustregel: **Beim zweiten Vorkommen extrahieren, nicht beim dritten.** Und
wenn du beim Reviewen eine bessere Variante derselben Sache im Repo findest,
ist das kein Lob für die bessere — es ist ein Bugreport für die schlechtere.

### Und zwei Meta-Punkte

**Nichts auf Vorrat bauen.** Die Multi-Tenancy im `whereClauseBuilder` filtert
auf eine Spalte, die in keiner Tabelle existiert. Sie ist nie gelaufen, hat
keinen Integrationstest, und in dem Moment, in dem ein JWT das Feld trägt,
fällt das Dashboard mit einem Syntaxfehler aus. Ein ungetesteter Vorratsbaustein
ist keine Vorbereitung, sondern eine Falle mit Zeitzünder.

**Bei einer Migration überträgt man Absichten, nicht Zeilen.** Dieses Schema
hat aus MySQL mitgebracht: `PRIMARY KEY` auf dem Kundennamen, das fehlende
`UNIQUE` auf `Rechnung."ID"`, Booleans als `tinyint`. Und es hat drei
Fremdschlüssel **verloren**, die MySQL noch hatte. Eine Migration ist der eine
Moment, in dem Altlasten kostenlos verschwinden können — dafür muss man aber
das Zielsystem benutzen (`numeric`, `boolean`, `timestamptz`, `CHECK`,
Partitionierung) statt das Quellsystem nachzubauen. Und danach mit einem echten
Datensatz gegenprüfen, nicht nur „läuft durch".
