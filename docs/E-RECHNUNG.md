# E-Rechnung (EN 16931): XRechnung & ZUGFeRD

Abgeschlossene Rechnungen lassen sich als strukturierte E-Rechnung nach **EN 16931** herunterladen:

| Format | Datei | Syntax / Profil | Typischer Empfänger |
|--------|-------|-----------------|---------------------|
| **XRechnung** | `Rechnung_<Nr>_XRechnung.xml` | UN/CEFACT CII D16B, XRechnung 3.0 | öffentliche Auftraggeber, Rechnungsportale |
| **ZUGFeRD** | `Rechnung_<Nr>_ZUGFeRD.pdf` | PDF/A-3b + eingebettete `factur-x.xml`, Profil EN 16931 | Geschäftskunden (B2B) – lesbar wie ein normales PDF |
| Excel (bisher) | `Rechnung_<Nr>.xlsx` | – | bleibt unverändert als Fallback erhalten |

**Bedienung:** Rechnungen → Rechnung öffnen → Buttons „XRechnung (XML)“ / „ZUGFeRD (PDF)“
(nur bei Status *final*). Fehlen Pflichtangaben, erscheint eine Liste mit Feld und BT-Nummer.

**API:** `GET /api/rechnungen/:id/erechnung?format=xrechnung|zugferd` (Rolle bearbeiter/admin).
Antwort `422` mit `{ error, fehler: [{ bt, feld, meldung }] }`, wenn die Rechnung nicht erzeugt werden kann.

## Einrichtung

1. **Steuernummer oder USt-IdNr. setzen** (Pflicht, BT-31/BT-32) – in der `.env`:
   ```
   VERKAEUFER_STEUERNUMMER=123/456/78901
   ```
   Die übrigen Verkäuferdaten (`VERKAEUFER_FIRMA`, `…_STRASSE`, `…_IBAN` usw., siehe `.env.example`)
   haben Standardwerte aus dem bisherigen Excel-Export und werden auch dort verwendet.
2. **Kundendaten pflegen** (Kunden → bearbeiten): Straße, PLZ, Ort, **Land** (ISO-Code, Standard `DE`)
   und für XRechnung die **E-Mail** (elektronische Adresse des Käufers, BT-49).
   Optional: **USt-IdNr.** (BT-48) und **Leitweg-ID** (BT-10, bei öffentlichen Auftraggebern Pflicht –
   ohne Angabe wird die Kundennummer als Käuferreferenz übermittelt).

Neue DB-Spalten (`Kunde.Land`, `Kunde.UStIdNr`, `Kunde.Leitweg_ID`) legt das Backend beim Start an.

## Datenmapping

| BT / BG | Bedeutung | Quelle |
|---------|-----------|--------|
| BT-1, BT-2 | Rechnungsnummer, -datum | `Rechnung.Nummer`, `Rechnung.Datum` |
| BT-3, BT-5 | Rechnungsart 380, Währung EUR | fest |
| BT-10 | Käuferreferenz / Leitweg-ID | `Kunde.Leitweg_ID`, sonst `Kunde.ID` |
| BT-20 | Zahlungsbedingung | „Die Rechnung ist sofort bei Erhalt fällig.“ |
| BT-22 | Hinweis | „Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer ausgewiesen.“ |
| BT-23, BT-24 | Prozess / Spezifikation | Peppol Billing; XRechnung 3.0 bzw. EN 16931 |
| BG-4/5/6 | Verkäufer, Anschrift, Kontakt | `VERKAEUFER_*` (`backend/src/utils/eRechnung/verkaeufer.js`) |
| BT-29/31/32 | Verkäuferkennung, USt-IdNr., Steuernummer | `VERKAEUFER_USTIDNR` / `VERKAEUFER_STEUERNUMMER` |
| BT-34, BT-49 | elektronische Adresse Verkäufer/Käufer | `VERKAEUFER_EMAIL`, `Kunde.Email` |
| BG-7/8 | Käufer, Anschrift | `Kunde.Name/Strasse/Hausnummer/PLZ/Ort/Land` |
| BT-46, BT-48 | Kundennummer, USt-IdNr. Käufer | `Kunde.ID`, `Kunde.UStIdNr` |
| BG-14, BT-72 | Leistungszeitraum, Lieferdatum | früheste/späteste Lieferschein-Datum der Stücke; ohne Lieferschein = Rechnungsdatum |
| BG-16/17 | SEPA-Überweisung (Code 58), IBAN, BIC | `VERKAEUFER_IBAN`, `VERKAEUFER_BIC` |
| BG-25 | Positionen | Schmuckstücke der Rechnung, gruppiert nach Basis-Artikelnummer (`MHO123_1`, `_2` → Menge 2) und Preis |
| BT-146/147/148 | Netto-, Rabatt-, Bruttopreis | `Verkaufspreis`, `Rechnung.rabatt_positionen` |
| BG-20 | Nachlässe auf Dokumentebene | `Rechnung.rabatt_gesamt` („Gesamtrabatt“), `Kunde.Provision` („Provision“) |
| BG-23 | Umsatzsteuer | Kategorie `E`, 0 %, „Kleinunternehmer gemäß § 19 UStG“ |

**Beträge** werden in ganzen Cent gerechnet: Positionsrabatt auf den Stückpreis, Gesamtrabatt auf die
Positionssumme, Provision auf den Betrag nach Gesamtrabatt – wie im Excel-Export, aber jeweils auf
Cent gerundet, damit die Summenregeln der EN 16931 exakt aufgehen.

## Validierung

Vor jeder Auslieferung prüft das Backend das XML **offline** (`backend/src/utils/eRechnung/validator.js`):

1. Pflichtangaben mit verständlichen Meldungen (welches Feld, wo es gepflegt wird)
2. XML-Schema CII D16B (`xmllint-wasm`)
3. Schematron EN 16931 (CEN 1.3.16) und – für XRechnung – XRechnung-Schematron 2.6.0 inkl. Peppol-Regeln
   (`saxon-js`, vorkompiliert unter `backend/src/assets/erechnung/`)

Das entspricht dem Szenario „EN16931 XRechnung (CII)“ des **KoSIT-Validators**. Schlägt eine Prüfung fehl,
wird keine Datei ausgeliefert. Der CI-Job `erechnung-validator` erzeugt Beispielrechnungen
(`backend/scripts/erechnung-beispiele.js`) und prüft sie mit dem echten KoSIT-Validator sowie
Mustang/veraPDF (PDF/A-3 und Factur-X).

Manuell prüfen:
```bash
cd backend && node scripts/erechnung-beispiele.js /tmp/erechnung
java -jar validationtool-<version>-standalone.jar -s <xrechnung-config>/scenarios.xml -r <xrechnung-config> /tmp/erechnung/*.xml
```

Regeln aktualisieren: siehe `backend/src/assets/erechnung/README.md`.

## Grenzen

- Nur **Kleinunternehmer** (§ 19 UStG, USt-Kategorie E) – wie bisher im Excel-Export. Für eine
  Regelbesteuerung müssten Steuersätze je Position ergänzt werden.
- Nur Rechnungen (Typ 380), keine Gutschriften/Stornorechnungen; Währung EUR.
- Kein automatischer Versand – die Datei wird heruntergeladen und z. B. per E-Mail oder Portal übermittelt.
- Schematron läuft mit SaxonJS (Saxonica-Lizenz, kostenlos nutzbar). SaxonJS rechnet große Ganzzahlen
  ungenau; die IBAN-Prüfungen BR-DE-19/20 werden deshalb im Backend mit BigInt nachgerechnet.
