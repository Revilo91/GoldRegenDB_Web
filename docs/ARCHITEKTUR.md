# GoldRegenDB – Vollständige Architekturdokumentation

Umfassende Referenz für Codebase, Datenbankschema, Geschäftslogik, API-Endpunkte und Sicherheitskonzepte.

---

## Inhaltsverzeichnis

1. [Geschäftsprozesse](#1-geschäftsprozesse)
2. [Datenbankschema](#2-datenbankschema)
3. [Artikelnummern-Format](#3-artikelnummern-format)
4. [Status-System der Schmuckstücke](#4-status-system-der-schmuckstücke)
5. [WHERE-Clause Builder](#5-where-clause-builder)
6. [Rabattlogik](#6-rabattlogik)
7. [Backend-Routes](#7-backend-routes)
8. [Frontend-Seiten](#8-frontend-seiten)
9. [Authentifizierung & Sicherheit](#9-authentifizierung--sicherheit)
10. [E-Rechnung](#10-e-rechnung)
11. [Fotos](#11-fotos)
12. [Bestellungen (DSGVO)](#12-bestellungen-dsgvo)
13. [Audit-Log](#13-audit-log)
14. [Technologie-Stack](#14-technologie-stack)
15. [Projektstruktur](#15-projektstruktur)
16. [Docker-Architektur](#16-docker-architektur)
17. [Bekannte Befunde & Fixes](#17-bekannte-befunde--fixes)

---

## 1. Geschäftsprozesse

GoldRegenDB ist ein Warenwirtschaftssystem für zwei Schmuckhandwerkerinnen (Marina `M` und Saskia `S`). Sie fertigen Schmuck handgefertigten Schmuck (Beton, Harz, Perlen, Holz etc.), lagern ihn bei Einzelhandelspartnern aus und rechnen verkaufte Stücke per Rechnung ab.

### Kernprozess

```
1. Stück anlegen (Artikelnummer, Art, Material, Preis, Foto)
        ↓
2. Lieferschein anlegen → Stücke zuordnen → physisch an Händler übergeben
        ↓  (Status: Im Lager → Aktiv ausgelagert)
3. Inventur: Welche Stücke liegen bei welchem Kunden? Wert berechnen
        ↓
4. Rechnung anlegen → verkaufte Stücke zuordnen → Rabatte eintragen → E-Rechnung exportieren
        ↓  (Status: → Verkauft)

   oder: Restock → Stücke zurücklagern → Status: Im Lager
```

### Beteiligte Entitäten

| Entität | Beschreibung |
|---------|-------------|
| `Schmuckstück` | Ein konkretes physisches Stück mit eindeutiger Artikelnummer |
| `Kunde` | Einzelhandelspartner (Läden, Messen, Online-Shop) – Lagerort für ausgelagerte Stücke |
| `Lieferschein` | Dokumentiert die physische Übergabe von Stücken an einen Kunden |
| `Rechnung` | Abrechnung der verkauften Stücke, inkl. Rabatte, Provision und E-Rechnung |
| `Foto` | Ein Foto je Basis-Artikelnummer, als BYTEA in PostgreSQL |
| `Bestellung` | Kundenauftrag über öffentliches Formular (DSGVO-konform verschlüsselt) |
| `audit_log` | Unveränderliches Änderungsprotokoll mit SHA-256-Hash-Kette |

---

## 2. Datenbankschema

### Tabellen

#### `Schmuckstück`
Kernentität. 33 Attribute.

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `Artikelnummer` | VARCHAR(20) PK | Format: `[H][M][P][NNN][_N]`, UPPER-Constraint |
| `Name` | TEXT | Bezeichnung |
| `Art` | TEXT | Produktart-Langname |
| `Grundmaterial` | TEXT | Material-Langname |
| `Farbe` | TEXT | Farbe |
| `Groesse` | TEXT | Größe/Maße |
| `Verkaufspreis` | NUMERIC(10,2) | Brutto-Verkaufspreis |
| `Einkaufspreis` / `Materialkosten` | NUMERIC(10,2) | Kosten |
| `Verkauft` | BOOLEAN | Verkauft (TRUE) oder nicht |
| `Ausschuss` | BOOLEAN | Ausgemustert |
| `Ausschuss_Grund` | TEXT | Grund (Default: "Defekt") |
| `Ausgelagert` | INTEGER | 0 = Im Lager; >0 = Kunden-ID |
| `Lieferschein_ID` | INTEGER | FK → Lieferschein.ID (0 = keiner) |
| `Rechnung_ID` | INTEGER | FK → Rechnung.ID (0 = keine) |
| `Letzte_Änderung` | TIMESTAMP | Automatisch per Trigger gepflegt |
| `Erstelldatum` | TIMESTAMP | Anlagedatum |

Constraint: `CHECK (NOT (Verkauft AND Ausschuss))` — ein Stück kann nicht gleichzeitig verkauft und Ausschuss sein.

#### `Kunde`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `Name` | TEXT PK | Eindeutiger Kundenname |
| `ID` | SERIAL | Numerische ID (UK), wird in `Ausgelagert` referenziert |
| `Provision` | NUMERIC | Provision in % (0–100) |
| `Land` | CHAR(2) | ISO 3166-1 (Default: `DE`) |
| `UStIdNr` | TEXT | Umsatzsteuer-ID für E-Rechnung |
| `Leitweg_ID` | TEXT | Leitweg-ID für XRechnung |
| `Direktverkauf` | BOOLEAN | Rechnung bietet Lagerstücke ohne Lieferschein an (Online, Messe …) |
| `Strasse`, `Hausnummer`, `PLZ`, `Ort` | TEXT | Rechnungsadresse |

#### `Lieferschein`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `Nummer` | VARCHAR(20) PK | Format: `YYYY-NNN` |
| `ID` | SERIAL UK | Numerische ID für FK-Referenzen |
| `Kundennummer` | INTEGER | FK → Kunde.ID |
| `Datum` | DATE | Ausstellungsdatum |
| `status` | TEXT | `entwurf` oder `final` |

#### `Rechnung`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `Nummer` | VARCHAR(20) PK | Format: `YYYY-NNN` |
| `ID` | SERIAL UK | Numerische ID |
| `Kundennummer` | INTEGER | FK → Kunde.ID |
| `Datum` | DATE | Ausstellungsdatum |
| `status` | TEXT | `entwurf` oder `final` |
| `rabatt_positionen` | JSONB | `{ "MHO123": 10, "MBA456": 5 }` – Rabatt je Basis-Artikelnummer (%) |
| `rabatt_gesamt` | NUMERIC | Gesamtrabatt auf den Beleg (%) |
| `versandkosten` | NUMERIC(10,2) | Versandkosten brutto, NULL = keine |
| `empfaenger` | JSONB | Anschrift eines Einmalkunden (Onlineshop), NULL = Kundenanschrift |

#### `Foto`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `Artikelnummer` | TEXT PK | Basis-Artikelnummer (`MHO123` gilt für `MHO123_1`, `_2`, …) |
| `Daten` | BYTEA | Bilddaten |
| `MimeType` | TEXT | `image/jpeg`, `image/png`, `image/gif` |
| `Groesse` | INTEGER | Dateigröße in Bytes |
| `Geaendert` | TIMESTAMP | Für ETag-Caching |

#### `audit_log`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `id` | SERIAL PK | |
| `artikelnummer_id` | TEXT | Betroffene Artikelnummer |
| `column_name` | TEXT | Geänderte Spalte |
| `old_value` / `new_value` | TEXT | Vorher/Nachher |
| `action_type` | TEXT | `UPDATE` |
| `changed_by` | TEXT | Benutzername aus `app.current_user` |
| `change_timestamp` | TIMESTAMP | Zeitpunkt |
| `previous_hash` | CHAR(64) | Hash des Vorgänger-Eintrags |
| `hash` | CHAR(64) | SHA-256 dieses Eintrags |

Überwachte Spalten: `Verkauft`, `Ausgelagert`, `Ausschuss`, `Ausschuss_Grund`, `Lieferschein_ID`, `Rechnung_ID`.

#### `app_users`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `id` | SERIAL PK | |
| `username` | TEXT UK | |
| `password_hash` | TEXT | bcrypt (10 Rounds) |
| `role` | TEXT | `admin` / `bearbeiter` / `user` |
| `active` | BOOLEAN | |
| `must_change_password` | BOOLEAN | Erzwingt Passwortänderung beim nächsten Login |
| `failed_login_attempts` | INTEGER | Zähler für Kontosperrung |
| `locked_until` | TIMESTAMP | Gesperrt bis (NULL = nicht gesperrt) |
| `reset_token_hash` | TEXT | SHA-256 des Reset-Tokens |
| `reset_token_expiry` | TIMESTAMP | Ablaufzeit des Tokens |

#### `lagerinventur`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `id` | SERIAL PK | |
| `user_id` | INTEGER FK → app_users.id | Ersteller |
| `data` | JSONB | `{ "MHO123_1": 2, "MBA456_2": 1 }` – gezählte Stückzahlen |
| `status` | TEXT | `entwurf` / `abgeschlossen` |
| `kommentar` | TEXT | Optionale Notiz |

#### Bestellungs-Tabellen

| Tabelle | Beschreibung |
|---------|-------------|
| `bestellung_kunde` | Bestell-Kundendaten; alle PII-Felder AES-256-GCM verschlüsselt (`*_enc` BYTEA) |
| `bestellung` | Bestellung selbst (Versandart, Status, Beschreibung, Wunschdatum, Rechnungsnummer) |
| `bestellung_consent` | Consent-Audit (Typ, Zeitpunkt, Datenschutzversion, IP-Hash) |
| `bestellung_foto` | Referenzfotos vom Kunden (BYTEA, PK = Dateiname) |

### Trigger

| Trigger | Tabelle | Zeitpunkt | Funktion |
|---------|---------|-----------|----------|
| `trg_update_letzte_aenderung` | Schmuckstück | BEFORE UPDATE | Setzt `Letzte_Änderung = NOW()` |
| `trg_audit_schmuckstueck` | Schmuckstück | AFTER UPDATE | Schreibt Statusänderungen in `audit_log` |
| `trg_audit_log_hash_chain` | audit_log | BEFORE INSERT | Berechnet SHA-256-Hash-Kette |
| `trg_audit_log_immutable` | audit_log | BEFORE UPDATE OR DELETE | **Blockiert jede Änderung** – Tamper-Schutz |
| `trg_bestellung_datenminimierung` | bestellung | BEFORE INSERT OR UPDATE | Lieferung erfordert Adresse; Abholung nur Telefon |
| `trg_bestellung_aktualisiert` | bestellung | BEFORE UPDATE | Setzt `aktualisiert_am = NOW()` |

### Wichtige Indizes

```sql
-- Schmuckstücke
idx_schmuck_status           ON "Schmuckstück"("Verkauft", "Ausschuss", "Ausgelagert")
idx_schmuck_lieferschein     ON "Schmuckstück"("Lieferschein_ID")
idx_schmuck_rechnung         ON "Schmuckstück"("Rechnung_ID")
idx_schmuck_artikelnummer_sort ON "Schmuckstück"(length("Artikelnummer"), "Artikelnummer")

-- Belege
idx_lieferschein_datum       ON "Lieferschein"("Datum" DESC)
idx_rechnung_datum           ON "Rechnung"("Datum" DESC)

-- Audit-Log
idx_audit_ts                 ON audit_log(change_timestamp DESC)
idx_audit_artikel            ON audit_log(artikelnummer_id, change_timestamp DESC)
```

---

## 3. Artikelnummern-Format

```
[Hersteller][Grundmaterial][Produktart][Laufnummer][_Suffix]

Hersteller (Position 1):
  M = Marina    S = Saskia

Grundmaterial (Position 2):
  A = Alkoholtinte    E = Edelstahl    K = Kordel       P = Perle         W = Holz
  B = Beton           F = Fimo         L = Leder         S = Schrumpffolie X = 3D-Druck
  C = Cucio           H = Harz         M = Makramee      Y = Cabochon
                      I = Phiole       N = Naturstein    J = Papier

Produktart (Position 3):
  A = Armband    H = Halskette    O = Ohrring    S = Schlüsselanhänger

Laufnummer: 3+ Ziffern, je Hersteller+Material+Produktart eindeutig
Suffix _N:  Gibt es mehrere physische Exemplare desselben Typs (MHO123_1, MHO123_2, …)

Beispiele:
  MHO123_1  →  Marina, Harz, Ohrring Nr. 123, Exemplar 1
  MBA234_2  →  Marina, Beton, Armband Nr. 234, Exemplar 2
  SHA001    →  Saskia, Harz, Armband Nr. 1 (kein Suffix = Einzelstück)
```

**Regeln:**
- Immer UPPERCASE (DB-Constraint: `CHECK (Artikelnummer = UPPER(Artikelnummer))`)
- Fotos werden unter der Basis-Artikelnummer gespeichert (`MHO123` gilt für `MHO123_1`, `MHO123_2`, …)
- Suffix wird beim Anlegen automatisch normalisiert (ohne Suffix → `_1`)

---

## 4. Status-System der Schmuckstücke

Jedes Stück hat genau einen von vier Zuständen, aus drei DB-Spalten zusammengesetzt:

| Status | `Ausgelagert` | `Verkauft` | `Ausschuss` | Bedeutung |
|--------|--------------|-----------|------------|-----------|
| **Im Lager** | `0` | `FALSE` | `FALSE` | Bereit zum Auslagern/Verkauf |
| **Aktiv ausgelagert** | `> 0` (Kunden-ID) | `FALSE` | `FALSE` | Physisch bei Kunde X |
| **Verkauft** | beliebig | `TRUE` | `FALSE` | Verkauft, Rechnung zugeordnet |
| **Ausschuss** | beliebig | beliebig | `TRUE` | Aussortiert |

`Ausgelagert` ist **keine Boolean**, sondern die **Kunden-ID**. `0` bedeutet „im Lager".

DB-Constraint verhindert `Verkauft=TRUE AND Ausschuss=TRUE` gleichzeitig.

**Pflicht:** Alle Schmuckstück-Abfragen müssen `whereClauseBuilder` verwenden — niemals Status-WHERE-Klauseln manuell schreiben.

---

## 5. WHERE-Clause Builder

Datei: `backend/src/utils/whereClauseBuilder.js`  
Dokumentation: `backend/src/utils/WHERE_BUILDER.md`

```javascript
const { where } = require('../utils/whereClauseBuilder');

const builder = where();
builder.verfuegbar();
const { rows } = await db.query(
  `SELECT * FROM "Schmuckstück" ${builder.build()}`,
  builder.getParams()
);
// → WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0

// Mit Alias (für JOINs)
const builder = where(1, { alias: 's' });
builder.aktivAusgelagert(kundeId);
// → WHERE s."Ausgelagert" = $1 AND s."Verkauft" IS FALSE AND s."Ausschuss" IS FALSE
```

### Verfügbare Methoden

| Methode | SQL |
|---------|-----|
| `.verfuegbar()` | `Verkauft IS FALSE AND Ausschuss IS FALSE AND Ausgelagert = 0` |
| `.aktivAusgelagert([kundeId])` | `Ausgelagert > 0 AND Verkauft IS FALSE AND Ausschuss IS FALSE` |
| `.imLager()` | `Ausgelagert = 0` |
| `.verkauft()` | `Verkauft IS TRUE AND Ausschuss IS FALSE` |
| `.nichtVerkauft()` | `Verkauft IS FALSE` |
| `.ausschuss()` | `Ausschuss IS TRUE` |
| `.keinAusschuss()` | `Ausschuss IS FALSE` |
| `.ausgelagert([kundeId])` | `Ausgelagert > 0` oder `Ausgelagert = $n` |
| `.mitLieferschein([id])` | `Lieferschein_ID > 0` oder `= $n` |
| `.ohneLieferschein()` | `Lieferschein_ID = 0` |
| `.mitRechnung([id])` | `Rechnung_ID > 0` oder `= $n` |
| `.ohneRechnung()` | `Rechnung_ID = 0` |
| `.grundmaterial(code)` | `Grundmaterial = $n` |
| `.produktart(code)` | `Art = $n` |
| `.hersteller(code)` | `UPPER(LEFT(Artikelnummer, 1)) = $n` |
| `.equals(field, value)` | `"field" = $n` |

---

## 6. Rabattlogik

Datei: `backend/src/utils/rabatt.js`

### Formel

```
Gesamtwert        = Σ( Einzelpreis × (1 − Positionsrabatt%) )
− Gesamtrabatt    = Gesamtwert × Gesamtrabatt%
Netto-Summe       = Gesamtwert − Gesamtrabatt
− Provision       = Netto-Summe × Provision%
+ Versandkosten   = fester Betrag, optional
= Überweisung
```

- **Positionsrabatt** (`rabatt_positionen` JSONB): gilt je Basis-Artikelnummer
- **Gesamtrabatt** (`rabatt_gesamt` NUMERIC): gilt für den gesamten Beleg
- **Provision**: Eigenschaft des Kunden (0–100 %)
- Rabatte gibt es nur bei Rechnungen, nicht bei Lieferscheinen
- **Versandkosten** (`versandkosten` NUMERIC, leer = keine): nur auf der Rechnung, nach Rabatt und Provision
  aufgeschlagen. Sie werden weder rabattiert noch provisioniert und gehören keiner Herstellerin, stehen also
  nicht in der Aufteilung. Excel zeigt „+ Versandkosten“, die E-Rechnung einen Zuschlag auf Belegebene
  (BG-21, Grund `FC`)

### SQL-Hilfsfunktionen

```javascript
preisNachPositionsrabattSql(s, r)    // Einzelpreis nach Positionsrabatt
preisNachAllenRabattenSql(s, r)      // Nach Positions- UND Gesamtrabatt
belegSummen(rechnungId, db)          // { summe, nachRabatt, provision, ueberweisung }
```

**Regel:** Immer diese Funktionen verwenden — Dashboard, Inventur, DocumentManager und Excel-Export nutzen alle dieselbe Formel.

---

## 7. Backend-Routes

Basis-URL: `/api`

### Authentifizierung (öffentlich, Rate-Limited)

```
POST   /auth/login               Login, setzt httpOnly-Cookie jwt
GET    /auth/me                  Aktuelle Benutzer-Info (Token validieren)
POST   /auth/logout              Cookie löschen
PUT    /auth/change-password     Eigenes Passwort ändern
POST   /auth/forgot-password                Reset-Token anfordern (ohne Link-Ausgabe)
POST   /auth/reset-password                 Passwort mit Token neu setzen
POST   /auth/admin/generate-reset-link      Reset-Link generieren und zurückgeben (admin)
```

### Schmuckstücke (bearbeiter+)

```
GET    /schmuckstuecke                      Liste (Paginierung, Filter, Suche)
GET    /schmuckstuecke/filter-options       Verfügbare Filter-Werte
GET    /schmuckstuecke/unique-artikelnummern Basis-Nummern für Inventur
GET    /schmuckstuecke/:artikelnummer       Einzelnes Stück
POST   /schmuckstuecke                      Neu anlegen
PUT    /schmuckstuecke/:artikelnummer       Aktualisieren
DELETE /schmuckstuecke/:artikelnummer       Löschen
POST   /schmuckstuecke/upload               Foto hochladen (max. 5 MB, JPG/PNG/GIF)
GET    /schmuckstuecke/foto/:fileName       Foto abrufen (ETag-Caching)
DELETE /schmuckstuecke/foto/:fileName       Foto löschen
```

### Kunden (bearbeiter+)

```
GET    /kunden                   Alle Kunden
GET    /kunden/:id               Einzelnen Kunden
GET    /kunden/:id/schmuckstuecke Ausgelagerte Stücke dieses Kunden
POST   /kunden                   Neuen Kunden anlegen
PUT    /kunden/:id               Bearbeiten
DELETE /kunden/:id               Löschen
PUT    /kunden/:id/restock       Alle ausgelagerten Stücke zurücklagern
PUT    /kunden/:id/restock-selective Ausgewählte Stücke zurücklagern
```

### Lieferscheine (bearbeiter+)

```
GET    /lieferscheine            Liste (Filter: status=entwurf|final)
GET    /lieferscheine/next-number Nächste Nummer (YYYY-NNN)
GET    /lieferscheine/:id        Lieferschein + zugeordnete Stücke + Summen
POST   /lieferscheine            Anlegen
PUT    /lieferscheine/:id        Bearbeiten
DELETE /lieferscheine/:id        Löschen
GET    /lieferscheine/:id/excel  Excel-Export
```

### Rechnungen (bearbeiter+)

```
GET    /rechnungen               Liste (Filter: status=entwurf|final)
GET    /rechnungen/next-number   Nächste Nummer (YYYY-NNN)
GET    /rechnungen/:id           Rechnung + Stücke + Rabatte + Summen
POST   /rechnungen               Anlegen
PUT    /rechnungen/:id           Bearbeiten
DELETE /rechnungen/:id           Löschen
GET    /rechnungen/:id/excel     Excel-Export
GET    /rechnungen/:id/erechnung E-Rechnung (XRechnung-XML oder ZUGFeRD-PDF/A-3)
```

### Inventur (bearbeiter+)

```
GET    /inventur                 Übersicht aller Kunden mit ausgelagerten Stücken
GET    /inventur/:kundeId        Detail: Stücke, Statistik, Wert nach Rabatten
GET    /inventur/:kundeId/excel  Excel-Export
```

### Lager-Inventur / Entwürfe (bearbeiter+)

```
GET    /lagerinventur/drafts              Eigene Entwürfe
GET    /lagerinventur/drafts/:id          Einzelnen Entwurf
POST   /lagerinventur/drafts             Neuen Entwurf anlegen
PUT    /lagerinventur/drafts/:id          Aktualisieren (nur status=entwurf)
POST   /lagerinventur/drafts/:id/complete Abschließen
GET    /lagerinventur/drafts/:id/diff     Soll/Ist-Vergleich mit aktuellem Bestand
```

### Bestellungen

```
POST   /bestellung                        Öffentlich: Neue Bestellung (Rate-Limit: 10/15 min)
GET    /bestelluebersicht                 Admin: Alle Bestellungen (inkl. entschlüsselte Kundendaten)
GET    /bestelluebersicht/:id             Admin: Einzelne Bestellung
PUT    /bestelluebersicht/:id             Admin: Aktualisieren
DELETE /bestelluebersicht/:id             Admin: Löschen
POST   /bestelluebersicht/:id/anonymisieren Admin: DSGVO-Anonymisierung
GET    /bestelluebersicht/foto/:fileName  Referenzfoto (öffentlich)
```

### Dashboard (bearbeiter+)

```
GET    /dashboard    Statistiken, Diagrammdaten, letzte Audit-Einträge
```

Liefert: `statistics`, `recentChanges`, `piecesByArt`, `piecesByKunde`, `statusDistribution`, `monthlyRevenueTrend`, `manufacturerStats`

### SumUp (bearbeiter+)

```
POST   /sumup/import    CSV-Import (erstellt Lieferscheine/Rechnungen)
GET    /sumup/export    CSV der verfügbaren Schmuckstücke
```

### Datensicherung (admin)

```
GET    /backup/export                   JSON aller Tabellen
POST   /backup/import                   JSON importieren
GET    /backup/export-fotos             ZIP aller Fotos (gestreamt, REPEATABLE READ)
POST   /backup/import-fotos-zip         ZIP importieren (async, gibt Job-ID zurück)
GET    /backup/import-fotos-jobs/:jobId Fortschritt des Foto-Imports
GET    /backup/export-sql               SQL-Dump als COPY-Blöcke
```

### Sonstige Admin-Routes

```
GET    /audit-log                   Audit-Log (paginiert)
GET    /audit-log/artikel/:nr       Log für ein Schmuckstück
GET    /audit-log/verify            Hash-Kette verifizieren

GET    /users                       Alle Benutzer
POST   /users                       Anlegen
PUT    /users/:id                   Bearbeiten
DELETE /users/:id                   Löschen

GET    /etiketten                   Etiketten-Datei (Artikelnummer, Preis, Barcode, QR)
GET    /debug/tables                DB-Tabellen auflisten
GET    /debug/tables/:name          Tabelleninhalt
PUT    /debug/tables/:name          Datensatz direkt bearbeiten
```

---

## 8. Frontend-Seiten

| Seite | Komponente | Route | Rollen |
|-------|-----------|-------|--------|
| Login | `Login.jsx` | `/login` | öffentlich |
| Dashboard | `Dashboard.jsx` | `/dashboard` | bearbeiter+ |
| Schmuckstücke | `Schmuckstuecke.jsx` | `/schmuckstuecke` | bearbeiter+ |
| Stück-Detail | `SchmuckstueckDetail.jsx` | `/schmuckstuecke/:nr` | bearbeiter+ |
| Kunden | `Kunden.jsx` | `/kunden` | bearbeiter+ |
| Lieferscheine | `Lieferscheine.jsx` | `/lieferscheine` | bearbeiter+ |
| Rechnungen | `Rechnungen.jsx` | `/rechnungen` | bearbeiter+ |
| SumUp | `Sumup.jsx` | `/sumup` | bearbeiter+ |
| Inventur | `Inventur.jsx` | `/inventur` | bearbeiter+ |
| Bestellungen | `Bestelluebersicht.jsx` | `/bestellungen` | admin |
| Bestellung (public) | `BestellungPublic.jsx` | `/bestellung` | öffentlich |
| Audit-Log | `AuditLog.jsx` | `/audit-log` | admin |
| Benutzerverwaltung | `Benutzerverwaltung.jsx` | `/benutzerverwaltung` | admin |
| Datensicherung | `Datensicherung.jsx` | `/datensicherung` | admin |
| Debug | `Debug.jsx` | `/debug` | admin |

### DocumentManager-Muster

`Lieferscheine.jsx` und `Rechnungen.jsx` sind dünne Wrapper um `DocumentManager.jsx`. Alle Listen-, Filter-, Gruppen- und Modal-Logik steckt im DocumentManager. Unterschiede zwischen den Belegtypen werden ausschließlich über Props (`type === "rechnung"` / `"lieferschein"`) gesteuert.

**Regel:** Änderungen an gemeinsamer Logik immer in `DocumentManager.jsx` durchführen und auf beide Belegtypen prüfen.

---

## 9. Authentifizierung & Sicherheit

### JWT & Session

- JWT (HS256, 8 h TTL) als **httpOnly-Cookie** `jwt` — nicht XSS-lesbar
- Fallback: `Authorization: Bearer <token>` für Skripte und E2E-Tests
- `api.js` sendet Cookie automatisch via `credentials: 'include'`
- Kein Token in localStorage

### Rollen

| Rolle | Zugriff |
|-------|---------|
| `user` | Nur `POST /api/schmuckstuecke` (Stücke anlegen) |
| `bearbeiter` | Alle Geschäftsseiten (Dashboard, Kunden, Schmuck, Belege, Inventur) |
| `admin` | Alles + Audit-Log, Benutzer, Backup, Debug, Bestellungen |

### CSRF (Double-Submit-Cookie)

- `GET /api/csrf-token` setzt lesbares Cookie `csrfToken`
- `api.js` spiegelt es als `X-CSRF-Token`-Header bei POST/PUT/PATCH/DELETE
- Vergleich in konstanter Zeit (`crypto.timingSafeEqual`)
- Nur für cookie-authentifizierte Requests — Bearer-Token-Clients sind ausgenommen

### Kontosperrung & Passwort-Reset

- 5 fehlgeschlagene Logins → Konto 30 Minuten gesperrt
- Unbekannte Benutzernamen laufen gegen Dummy-Hash (timing-sicher)
- Reset-Link wird über `POST /api/auth/admin/generate-reset-link` (admin-only) erzeugt und direkt im Response zurückgegeben — das Token erscheint nicht im Log
- Admin kopiert den Link und gibt ihn an den Benutzer weiter; kein SMTP konfiguriert
- Nur SHA-256-Hash des Reset-Tokens wird in der DB gespeichert

### Passwort-Migration

Altkonten nutzten `bcrypt(sha256(pwd))`. Beim ersten erfolgreichen Login wird auf `bcrypt(pwd)` (10 Rounds) migriert.

### Input-Validierung

Alle schreibenden Routes nutzen `validate(schema)` mit Zod. Schemas in `backend/src/schemas/index.js`. Unbekannte Felder werden entfernt. Fehler: `400 { error, details }`.

### Content-Security-Policy

```
style-src:      'unsafe-inline' + fonts.googleapis.com
font-src:       data: + fonts.gstatic.com
img-src:        data: + blob:
frame-ancestors: 'none'
```

### Cookie-Attribute (`backend/src/utils/authCookie.js`)

Alle Cookie-Attribute für `jwt` sind ausschließlich hier definiert — nie direkt `res.cookie('jwt', …)` in einer Route aufrufen.

| Attribut | Wert | Grund |
|----------|------|-------|
| `httpOnly` | `true` | JavaScript kann das Token nicht lesen (XSS-Schutz) |
| `sameSite` | `lax` | Blockt site-fremde POSTs, erlaubt normale Navigation |
| `secure` | `COOKIE_SECURE === 'true'` | Nur setzen, wenn ein Reverse Proxy TLS terminiert |
| `maxAge` | 8 h | Passend zur JWT-Laufzeit |

### CORS (`backend/src/middleware/cors.js`)

Die API ist nur für explizit erlaubte Origins geöffnet, konfiguriert über `ALLOWED_ORIGINS` (kommasepariert):

```
ALLOWED_ORIGINS=http://localhost:5173,https://schmuck.example.com
```

- Ohne gesetzte Variable gelten die lokalen Dev-Origins (`localhost:5173` / `localhost:3000`)
- Requests ohne `Origin`-Header (same-origin, curl, Healthcheck) werden immer durchgelassen
- In Produktion liefert Express das Frontend selbst aus — same-origin, keine CORS-Prüfung nötig
- `Content-Disposition` und `X-Upload-File-Count` sind als Response-Header freigegeben (werden von `api.js` bei Downloads ausgelesen)

### HTTPS / TLS (`backend/src/middleware/httpsRedirect.js`)

Express terminiert kein TLS selbst — das übernimmt ein vorgeschalteter Reverse Proxy. Drei Env-Vars steuern das Verhalten:

| Variable | Wirkung |
|----------|---------|
| `TRUST_PROXY` | `app.set('trust proxy', …)` — nötig, damit Express `X-Forwarded-*` nur vom echten Proxy akzeptiert |
| `FORCE_HTTPS` | Aktiviert 301-Redirect auf HTTPS + HSTS + `upgrade-insecure-requests` in der CSP |
| `HSTS_MAX_AGE` | Gültigkeit des HSTS-Headers in Sekunden (Standard: 15552000 = 180 Tage) |

Alle drei sind standardmäßig deaktiviert — nativer Dev-Modus hat keinen TLS-Proxy.

### Secrets-Management

Umgebungsvariablen können über `<NAME>_FILE` (Docker Secrets) geladen werden. `getSecret()` prüft beides. `NODE_ENV=production` erzwingt vollständige Secrets.

---

## 10. E-Rechnung

Datei: `backend/src/utils/eRechnung/`  
Details: `docs/E-RECHNUNG.md`

| Eigenschaft | Wert |
|------------|------|
| Standard | EN 16931 |
| Formate | XRechnung 3.0 (CII-XML), ZUGFeRD 2.0 / Factur-X (PDF/A-3 + eingebettetes XML) |
| Validierung | XSD + Schematron, offline (identisch mit KoSIT-Validator) |
| PDF-Rendering | `pdf-lib` + `@pdf-lib/fontkit` |
| Steuer | Kategorie `E` (Kleinunternehmer §19 UStG, 0 % MwSt.) |

### Datenquellen

| Quelle | Felder |
|--------|-------|
| `.env` | Verkäuferdaten: `VERKAEUFER_NAME`, `VERKAEUFER_STRASSE`, `VERKAEUFER_PLZ`, `VERKAEUFER_ORT`, `VERKAEUFER_STEUERNUMMER`, SEPA-Konto |
| `Kunde` | `Name`, `Strasse`, `Hausnummer`, `PLZ`, `Ort`, `Land`, `UStIdNr`, `Leitweg_ID` |
| `Rechnung` + `Schmuckstück` | Positionen, Rabatte, Umsatzsteuer |

**Direktverkauf** (`Kunde.Direktverkauf`, Häkchen in der Kundenverwaltung; gesetzt für Online, Messe,
Sonderanfertigung, Saskia Stempfhuber): Die Rechnung bietet Lagerstücke plus die bei diesem Kunden ausgelagerten
an (`GET /api/schmuckstuecke?ausgelagert=0,15`), ein Lieferschein vorab entfällt. Übrige Kunden sehen weiter nur
ihre ausgelagerten Stücke. Die Erstbelegung setzt `db.js` einmalig beim Anlegen der Spalte.

**Einmalkunden (Onlineshop):** Die Rechnung läuft auf den Sammelkunden „Online“, die Anschrift des Käufers
steht in `Rechnung.empfaenger` (Name, Strasse, Hausnummer, PLZ als Text, Ort, Land, Email). Excel und
E-Rechnung überschreiben damit die Kundenanschrift (`mitEmpfaenger()` in `rechnungen.js`, USt-IdNr entfällt).
Erfasst wird sie im Rechnungsdialog über `components/EmpfaengerModal.jsx`; es entsteht kein Eintrag in `Kunde`.

---

## 11. Fotos

### Speicherung

Fotos liegen als BYTEA in PostgreSQL, **nicht** im Dateisystem:

| Tabelle | Schlüssel | Kontext |
|---------|----------|---------|
| `Foto` | Basis-Artikelnummer | Schmuckstück-Fotos (geteilt über Exemplare) |
| `bestellung_foto` | Dateiname | Referenzfotos aus Bestellformular |

### Regeln

- Lesen/Schreiben nur über `backend/src/utils/fotoService.js`
- Listen prüfen Vorhandensein per `EXISTS`-Subquery (`hatFotoSql()`) — kein BYTEA in Listenabfragen
- Max. 5 MB pro Foto; Typ per **Magic Bytes** geprüft (nicht Dateiendung)
- Upload: `multer.memoryStorage()` in `schmuckstuecke.js`
- Auslieferung: ETag aus `Geaendert`-Timestamp, `Cache-Control: private, max-age=60`
- Kein Datei-Fallback: ohne DB-Eintrag → 404

### Backup

Fotos werden **nicht** durch den JSON-Export gesichert (BYTEA als base64 würde ~1,6 GB erzeugen):

```
GET  /api/backup/export-fotos          ZIP aller Fotos (REPEATABLE-READ-Snapshot, gestreamt)
POST /api/backup/import-fotos-zip      ZIP importieren (async Hintergrund-Job, Upsert)
GET  /api/backup/import-fotos-jobs/:id Fortschritt abfragen
```

### Bestandsimport (`scripts/import-fotos.js`)

```bash
npm run import:fotos -- --dir <pfad> [--dry-run] [--overwrite] [--log <datei>]
```

- Dateiname = Artikelnummer; `_N`-Suffix wird zur Basis-Nummer normalisiert
- Übersprungen: mehrere Nummern im Namen, unbekannte Nummer, Datei > 5 MB, kein gültiges Bild, vorhandenes Foto (ohne `--overwrite`)
- Problematische Fälle werden im Log mit „manuell" markiert

---

## 12. Bestellungen (DSGVO)

### Datenschutzkonzept

- Alle PII-Felder (Name, E-Mail, Telefon, Adresse) in `bestellung_kunde` AES-256-GCM verschlüsselt
- IP-Adresse wird gehasht (SHA-256), nie im Klartext gespeichert
- Datenminimierung per DB-Trigger: Lieferung → Adresse + Telefon erforderlich; Abholung → nur Telefon
- Anonymisierung (DSGVO Art. 17): `POST /api/bestelluebersicht/:id/anonymisieren` löscht alle PII in einer Transaktion: verschlüsselte Kontaktfelder in `bestellung_kunde`, `beschreibung` und `foto_pfad` in `bestellung`, Foto-Binärdaten in `bestellung_foto`. Transaktionsdaten bleiben für Buchhaltung erhalten. Auslöser: Admin-Route und `npm run dsgvo:retention`

### Öffentliches Formular

- Rate-Limit: 10 Anfragen / 15 Minuten pro IP
- Honeypot-Feld gegen Bots
- Consent-Audit: Typ, Zeitpunkt, Datenschutzversion werden protokolliert

---

## 13. Audit-Log

### Automatisches Tracking

Der Trigger `trg_audit_schmuckstueck` schreibt nach jedem UPDATE auf `Schmuckstück` einen Eintrag in `audit_log` für die Spalten: `Verkauft`, `Ausgelagert`, `Ausschuss`, `Ausschuss_Grund`, `Lieferschein_ID`, `Rechnung_ID`.

Der Benutzername kommt aus `app.current_user`, das im `authenticate`-Middleware per `SET LOCAL app.current_user = 'username'` für den Request gesetzt wird.

### Tamper-Schutz

- Jeder Eintrag enthält `previous_hash` des Vorgängers und `hash = SHA256(id|...|previous_hash)`
- `trg_audit_log_immutable` blockiert jedes UPDATE/DELETE auf `audit_log` (auch für DB-Admins via SQL)
- Verifizierung: `GET /api/audit-log/verify` → ruft `verify_audit_chain()` auf

---

## 14. Technologie-Stack

| Schicht | Technologie |
|---------|-------------|
| Datenbank | PostgreSQL 16 |
| Backend | Node.js + Express.js (kein ORM, direktes `pg`) |
| Authentifizierung | JWT HS256 + bcryptjs (10 Rounds) + httpOnly-Cookie |
| Validierung | Zod |
| Logging | Strukturiert (`logger.js`): `YYYY-MM-DDTHH:mm:ss [LEVEL] [KOMPONENTE] message` |
| Rate-Limiting | express-rate-limit |
| Security-Headers | helmet, CSP, X-Content-Type-Options, X-Frame-Options |
| Excel-Export | exceljs |
| E-Rechnung | pdf-lib, xmllint-wasm (XSD), saxon-js (Schematron) |
| Foto-Validierung | Magic Bytes, image-size |
| PII-Verschlüsselung | AES-256-GCM (Node.js crypto) |
| Frontend | React 19 + Vite + React Router v7 |
| Diagramme | Recharts |
| Icons | Font Awesome (Solid + Regular) |
| Container | Docker + Docker Compose |
| Tests | Jest (Backend), Vitest (Frontend); Coverage-Schwellen in `backend/package.json` und `frontend/vite.config.js`, nur anheben (Ratchet) |

### Architektur-Highlights

1. **Request-scoped DB-Client**: Jeder Request belegt einen dedizierten Client → `SET LOCAL app.current_user` wirkt exakt für diesen Request (Audit-Trigger nutzen es)
2. **WHERE-Clause Builder**: Zentrale Query-Konstruktion → konsistente Geschäftslogik über alle Routes
3. **Rabatt-Formel-Zentrale**: Eine SQL-Funktion → Dashboard, Inventur, Beleg, DocumentManager rechnen identisch
4. **Foto als BYTEA**: Transaktionssicherheit, Backup-Integrität, Basis-Artikelnummer-Sharing
5. **Hash-Kette Audit-Log**: SHA-256-Verkettung + Trigger-Immutabilität → Tampering-Detection
6. **DSGVO by Design**: Verschlüsselte PII, Datenminimierung, Anonymisierung, Consent-Audit
7. **E-Rechnung offline**: Vollständige EN-16931-Validierung ohne externe Abhängigkeit

---

## 15. Projektstruktur

```
GoldRegenDB_Web/
├── Dockerfile                        # Produktions-Image (Multi-Stage: Frontend-Build → Express)
├── docker-compose.yml                # Produktion (ein app-Service)
├── docker-compose.dev.yml            # Entwicklung, voll containerisiert
├── docker-compose.proxy.yml          # Overlay: Caddy-Reverse-Proxy mit TLS
├── proxy/Caddyfile                   # Caddy-Konfiguration
├── package.json                      # Root npm Workspace (backend, frontend) + npm run dev
├── .env.example                      # Vorlage für Umgebungsvariablen
│
├── .github/
│   └── workflows/
│       ├── tests.yml                 # CI: Jest + Vitest mit Coverage-Schwellen bei jedem PR
│       ├── check-architektur.yml     # CI: Warnt wenn docs/ARCHITEKTUR.md nicht mitgeändert wurde
│       └── release.yml               # CI: Release-Workflow
│
├── db/
│   ├── init.sql                      # Schema (Tabellen, Trigger, Funktionen)
│   ├── seed.sql                      # Demo-Daten
│   ├── backup.sh / restore.sh        # Automatische Backups
│   └── README.md                     # Backup/Restore-Dokumentation
│
├── docs/
│   ├── ARCHITEKTUR.md                # Diese Datei
│   └── E-RECHNUNG.md                 # E-Rechnung-Details
│
├── backend/
│   ├── __tests__/                    # Jest-Tests
│   └── src/
│       ├── index.js                  # Express Entry-Point
│       ├── config/db.js              # PostgreSQL-Pool + Startup-Migrationen
│       ├── routes/                   # REST-Endpunkte (auth, kunden, schmuckstuecke, …)
│       ├── middleware/               # auth.js, csrf.js, cors.js, validate.js, …
│       ├── schemas/                  # Zod-Schemas für Input-Validierung
│       └── utils/
│           ├── whereClauseBuilder.js # WHERE-Clause Builder
│           ├── WHERE_BUILDER.md      # Builder-Dokumentation
│           ├── rabatt.js             # Zentrale Rabatt-/Provisions-Formel
│           ├── excelService.js       # Excel-Export
│           ├── fotoService.js        # Foto-CRUD (Tabellen Foto, bestellung_foto)
│           ├── fotoZip.js            # Foto-Backup als ZIP
│           ├── eRechnung/            # XRechnung/ZUGFeRD (modell, cii, validator, zugferdPdf)
│           ├── logger.js             # Strukturiertes Logging
│           ├── passwordService.js    # bcrypt-Hashing + Legacy-Migration
│           ├── accountSecurity.js    # Account-Lockout + Passwort-Reset
│           ├── authCookie.js         # JWT-Cookie setzen/löschen
│           └── constants.js          # GRUNDMATERIAL, PRODUKTART-Codes
│
└── frontend/
    ├── __tests__/                    # Vitest-Tests
    └── src/
        ├── App.jsx                   # Router + Layout
        ├── api.js                    # Zentraler API-Client
        ├── index.css                 # Globale Styles (alle Klassen hier)
        ├── context/AuthContext.jsx   # JWT-Auth-State + Rollen
        ├── components/               # DataTable, TableToolbar, PhotoUpload, ProtectedRoute, Toast
        ├── hooks/useFoto.js          # Foto per Artikelnummer laden (Tabelle, Modal, Detail, Upload)
        └── pages/                    # Alle Seiten (Login, Dashboard, Schmuckstuecke, …)
```

---

## 16. Docker-Architektur

Frontend und Backend laufen als **eine App**: das Root-Dockerfile baut das Vite-Frontend und kopiert `dist/` als `public/` ins Express-Image. Express liefert API (`/api/*`) und statisches Frontend auf demselben Port — kein Nginx in Produktion.

### Ports

| Service | Nativ (`npm run dev`) | Docker Dev | Produktion |
|---------|----------------------|------------|------------|
| Frontend | 5173 (Vite) | 3000 → 5173 (Vite) | 3000 (Express) |
| Backend | 3001 | 3001 | 3000 (Express, same-origin) |
| Datenbank | 5432 | 5432 | 5432 |

### Umgebungsvariablen

```
# Datenbank
DB_PASSWORD=changeme
POSTGRES_DB=goldregendb
POSTGRES_USER=goldregen
DATABASE_URL=postgresql://goldregen:changeme@localhost:5432/goldregendb

# App
NODE_ENV=development
PORT=3001
JWT_SECRET=change-this-to-a-long-random-secret

# Frontend
VITE_API_URL=http://localhost:3001/api

# Optional (Produktion)
ALLOWED_ORIGINS=https://schmuck.example.com
TRUST_PROXY=1
FORCE_HTTPS=true
COOKIE_SECURE=true
BESTELLUNG_ENCRYPTION_KEY=...   # AES-256 für DSGVO-Felder
```

Secrets (`JWT_SECRET`, `DB_PASSWORD`, `BESTELLUNG_ENCRYPTION_KEY`) können statt als Klartext auch über `<NAME>_FILE` (Docker-Secret-Datei) gesetzt werden.

---

## 17. Bekannte Befunde & Fixes

Historische Bugfixes, die das aktuelle Design erklären:

| Befund | Problem | Fix / aktueller Zustand |
|--------|---------|------------------------|
| **B1** | `DOUBLE PRECISION` verliert Genauigkeit bei Preisberechnungen | `NUMERIC(10,2)` im Schema |
| **B4** | `Rechnung.ID` nicht UNIQUE → JOINs mischen Positionen | UNIQUE Constraint |
| **B6** | Status-Spalten als `SMALLINT (0/1/NULL)` → NULL in keinem Filter | `BOOLEAN`-Spalten; `ensureStatusBooleans()` in `db.js` korrigiert Alt-Daten |
| **B11** | Fehlende Indizes → Sequential Scan + Re-Sort | Indizes auf Datum, FK, Status, Artikelnummer |
| **C17/C18** | Rabatte nur in `excelService.js`, nicht in Dashboard/Inventur | Zentrale `preisNachAllenRabattenSql()` in `rabatt.js` |
| **D1/D2** | Zahlenfelder als Text → `parseFloat("") = NaN` → `JSON.stringify(NaN) = null` → NULL-UPDATE | `parseZahlOderNull()`-Normalisierung in Formularen |
| **D4** | Artikelnummern nur im Frontend großgeschrieben → Duplikate | `UPPER()` in Zod-Schema + DB-Constraint |
| **#131** | Altkonten: `bcrypt(sha256(pwd))` → Inkompatibilität | `verifyPassword()` prüft beide; 1. erfolgreicher Login migriert |
| **#135** | `csurf` deprecated | Eigene Double-Submit-Cookie-Implementierung |
| **#138** | Express ohne TLS hinter Proxy | `TRUST_PROXY`, `FORCE_HTTPS`, `COOKIE_SECURE` als Env-Vars |
| **#139** | Audit-Log nachträglich manipulierbar | Hash-Kette + Immutabilitäts-Trigger |
| **#208** | Fotos im Dateisystem → kein Backup, keine Transaktionssicherheit | BYTEA in Tabelle `Foto` |
| **#214** | Spalte `"Schmuckstück"."Foto"` entfernt; Listen zeigten BYTEA | `hatFoto` (boolean) via `EXISTS`; `DROP COLUMN IF EXISTS` in `db.js` |
