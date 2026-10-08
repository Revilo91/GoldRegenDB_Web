# Anforderungs-Review: offene Fragen und Lücken

Stand: 2026-10-01, Commit `1b14faa`. Sicht eines Requirements Engineers, der das
Projekt übernimmt. Technische Fehler stehen bereits in
`AUDIT_LOGIK_DATENBANK.md`; dieses Dokument fragt nach dem **Was** und
**Warum**: fachliche Regeln, die nirgends festgelegt sind, und Anforderungen,
die niemand gestellt hat.

**So beantworten:** Unter jeder Frage steht `Antwort:`. Kurz ausfüllen, gerne
nur „ja/nein/egal“. Unbeantwortete Fragen bleiben offen und blockieren nichts.

Priorität: **P1** = rechtliches oder finanzielles Risiko · **P2** = Fehlverhalten
im Alltag · **P3** = Komfort/Ausbau.

---

## Kurzfassung: die fünf größten Lücken

1. **Rechnungen sind nicht unveränderlich.** Finale Rechnungen lassen sich ändern
   und löschen, auch die Nummer. Es gibt kein Storno und kein Archiv (F1–F4).
2. **Belege rechnen live.** Preis und Provision werden beim Anzeigen aus
   Stück und Kunde gelesen. Wer heute einen Preis ändert, ändert alte Rechnungen
   (F5, F6).
3. **Wer stellt die Rechnung aus?** Es gibt genau einen Verkäufer (aus `.env`),
   aber zwei Herstellerinnen auf einer Rechnung (F7).
4. **§19 UStG ohne Grenzwächter.** Die Umsatzgrenze wird nicht überwacht; eine
   Umstellung auf Regelbesteuerung ist im Code nicht vorgesehen (F8).
5. **Backup nur halb automatisch.** Kein Zeitplan im Stack, keine Kopie außer
   Haus, kein Restore-Test, kein Alarm (F20–F22).

---

## Teil A – Fragen an die Fachseite

### Rechnungen und Belege

**F1 [P1] Darf eine finale Rechnung noch geändert oder gelöscht werden?**
Befund: `PUT /rechnungen/:id` ändert auch finale Rechnungen (Nummer, Kunde,
Positionen, Rabatte, Status zurück auf Entwurf). `DELETE` prüft den Status nicht
(`backend/src/routes/rechnungen.js:501`, `:611`).
Vorschlag: Ab `final` gesperrt; Korrektur nur per Stornorechnung.
Antwort: korrekt, sobald auf final nicht mehr änderbar

**F2 [P1] Brauchen wir Stornorechnungen bzw. Gutschriften?**
Befund: Gibt es nicht; `docs/E-RECHNUNG.md` schließt sie aus.
Frage: Wie wird heute eine falsche Rechnung korrigiert? Wie oft passiert das?
Antwort: Bis jetzt noch nie

**F3 [P1] Müssen Rechnungsnummern lückenlos sein?**
Befund: `MAX+1` je Jahr. Wird die letzte Rechnung gelöscht, wird ihre Nummer neu
vergeben; die Nummer ist frei editierbar (`rechnungen.js:15`, `:509`).
Frage: Was hat die Steuerberatung dazu gesagt?
Antwort: Haben wir noch nicht, da zu klein

**F4 [P1] Muss die ausgestellte Rechnung (PDF/XML) archiviert werden?**
Befund: Excel und E-Rechnung werden bei jedem Abruf neu erzeugt
(`rechnungen.js:206`, `:290`). Es gibt keine gespeicherte Originalfassung. Für
GoBD ist i. d. R. eine unveränderte Aufbewahrung (10 Jahre) nötig – bitte mit
Steuerberatung klären.
Antwort: Ignorieren, da keine Umsatzsteuer auf die Produkte gegeben, kleingewerbe

**F5 [P1] Soll eine Preisänderung alte Belege ändern?**
Befund: Rechnungen speichern keine Preise; `belegSummen()` liest
`Schmuckstück.Verkaufspreis` live (`backend/src/utils/rabatt.js:101`).
Vorschlag: Preis beim Finalisieren in den Beleg schreiben (Snapshot).
Antwort: Umsetzen

**F6 [P1] Soll eine geänderte Kundenprovision alte Belege ändern?**
Befund: Provision kommt per JOIN aus `Kunde` (`rabatt.js:121`), keine Historie,
kein Audit auf `Kunde`.
Antwort: Nein, nur die neuen

**F7 [P1] Wer ist rechtlich Rechnungsstellerin?**
Befund: Die E-Rechnung hat einen Verkäufer aus `VERKAEUFER_*` (`.env`). Eine
Rechnung kann Stücke von Marina **und** Saskia enthalten. Der SumUp-Import
erzeugt dagegen je Herstellerin eine eigene Rechnung.
Frage: GbR, zwei Einzelunternehmen oder eine Firma mit Unterauftrag? Davon hängt
ab, ob gemischte Rechnungen überhaupt zulässig sind.
Antwort: nein, gilt als eine GbR. Ist nur der Übersichtshalber entstanden, dass bei einem SumUp import zwei rechnungen erzeugt werden. Kann gern auch anders gelöst werden.

**F8 [P1] Was passiert, wenn die Kleinunternehmergrenze überschritten wird?**
Befund: 0 % MwSt. und §19-Hinweis sind fest verdrahtet
(`backend/src/utils/eRechnung/modell.js:16`). Keine Warnung, kein Steuersatzfeld.
Fragen: Gilt die Grenze je Person oder gemeinsam? Soll das Dashboard warnen
(z. B. bei 80 %)? Ist Regelbesteuerung absehbar?
Antwort: Brauchen wir noch nicht

**F9 [P2] Wie werden Versandkosten zwischen Marina und Saskia aufgeteilt?**
Befund: Sie landen nur im Überweisungsbetrag, gehören keiner Herstellerin
(`rabatt.js:23`).
Antwort: Genau, ist egal, normalerweise immer Marina. Ist aber eher zu ignorieren

**F10 [P2] Gibt es gemeinsam gefertigte Stücke oder weitere Herstellerinnen?**
Befund: Die Zuordnung hängt am ersten Buchstaben der Artikelnummer
(`rabatt.js:130`). Alles, was nicht `M` ist, bekommt per Rest-Logik Saskia.
Antwort: Nein, beide Produzieren getrennt

**F11 [P2] Soll festgehalten werden, was an wen ausgezahlt wurde?**
Befund: Die Aufteilung wird angezeigt, aber nichts als „ausgezahlt“ gespeichert;
es gibt keinen Abrechnungszeitraum.
Antwort: Nein, aber es wäre von Vorteil irgendwo in der DB das sichtbar zu machen.

### Lieferschein und Lager

**F12 [P2] Darf ein Stück, das schon bei Kunde A liegt, auf einen Lieferschein für Kunde B?**
Befund: `lagereAus` überschreibt `Ausgelagert`/`Lieferschein_ID` ohne Prüfung,
auch bei verkauften oder Ausschuss-Stücken
(`backend/src/utils/statusUebergaenge.js:25`). Der alte Lieferschein verliert die
Position still.
Vorschlag: Ablehnen mit Meldung, außer bei ausdrücklichem „Umlagern“.
Antwort: Vorschlag umsetzen

**F13 [P2] Muss ein Lieferschein nach Rücknahme noch zeigen, was ursprünglich geliefert wurde?**
Befund: Positionen hängen am Stück. Nach Restock verschwinden sie aus dem
Lieferschein; der Beleg ändert sich rückwirkend.
Antwort: Wäre als History irgendwie schon noch gut. Anderen Vorschlag?

**F14 [P2] Was soll „Lagerinventur abschließen“ bewirken?**
Befund: Setzt nur `status = abgeschlossen`; keine Korrektur, kein eingefrorener
Soll-Stand (`backend/src/routes/lagerinventur.js:376`). Der Diff eines
abgeschlossenen Entwurfs ändert sich mit dem Lager.
Fragen: Sollen fehlende Stücke als Ausschuss gebucht werden? Sollen beide Frauen
gemeinsam an einer Zählung arbeiten (heute nur eigene Entwürfe)?
Antwort: Es soll angezeigt werden, was fehlt und dann als Ausschuss. Beide können das durchführen oder mit Helfern, dass ist egal

**F15 [P3] Wird auf Messen ohne Internet verkauft?**
Befund: Kein Offline-Modus, keine PWA. Verkäufe laufen heute über SumUp-CSV.
Antwort: Eventuell mal einplanen?

### SumUp-Import

**F16 [P2] Welcher Preis gilt: SumUp-Kassenpreis oder DB-Preis?**
Befund: Menge und Preis aus der CSV werden ignoriert, es zählt der DB-Preis
(`backend/src/routes/sumup.js`). Messe-Rabatte gehen so verloren.
Antwort: DB soll immer Master sein, wenns es Rabatt gab, einfach ignorieren

**F17 [P3] Soll ein doppelter Import erkannt werden?**
Befund: Kein Dateihash, keine Transaktions-ID. Schutz nur indirekt, weil
verkaufte Stücke nicht mehr gefunden werden.
Antwort: Bitte beheben

### Bestellformular und DSGVO

**F18 [P2] Wer wird über neue Bestellungen informiert, und wie?**
Befund: Kein Mailversand, weder an Kundin noch an Handwerkerinnen. Bestellungen
fallen nur auf, wenn jemand die Übersicht öffnet.
Antwort: Das ist so gewollt, da man diese dort findet

**F19 [P1] Wer startet die DSGVO-Löschung, und wann?**
Befund: `npm run dsgvo:retention` existiert, wird aber nirgends geplant.
Offene Bestellungen werden nie anonymisiert. Bestellstatus ist frei setzbar
(keine Übergangsregeln).
Frage: Wer ist verantwortlich? Gibt es ein Verarbeitungsverzeichnis?
Antwort: Nein und verantworlich soll der Admin sein. Anonymisiert soll nach bearbeitung von der Bestellung

### Betrieb und Datensicherung

**F20 [P1] Wo liegt die Sicherung außer auf der Synology?**
Befund: `db/backup.sh` rotiert lokal (7 täglich, 4 wöchentlich). Keine
Offsite-Kopie im Repo. Brand/Diebstahl/Ransomware = Totalverlust.
Antwort: Da hast du Recht, wo schlägst du vor? Bitte Issue dazu erstellen

**F21 [P1] Wer startet das Backup und wer merkt, wenn es fehlschlägt?**
Befund: Cron ist nur dokumentiert (`db/README.md`), kein Alarm.
Antwort: Bitte Issue erstellen

**F22 [P2] Wann wurde zuletzt ein Restore wirklich ausprobiert?**
Befund: Release-Smoke-Test führt nur `backup.sh` aus, kein Restore.
Ziel festlegen: Wie viele Stunden Datenverlust (RPO) und Ausfall (RTO) sind tragbar?
Antwort: Max 1 Tag oder bei Änderungen

**F23 [P2] Ist die App aus dem Internet erreichbar?**
Befund: Caddy mit TLS ist vorbereitet; die Synology-Compose hat
`COOKIE_SECURE`/`FORCE_HTTPS` standardmäßig `false` und gibt den DB-Port 15432
am Host frei. Keine 2FA.
Frage: Nur im Heimnetz/VPN oder öffentlich? Davon hängt ab, ob 2FA Pflicht wird.
Antwort: Öffentlich, bitte Issue erstellen

**F24 [P3] Auf welchen Geräten wird gearbeitet?**
Handy auf Messen, Tablet, nur PC? Davon hängen Responsive-Tests und Etikettendruck ab.
Antwort: Handy und PC, PC für Drucke genutzt

### Rollen

**F25 [P3] Wer hat welche Rolle, und braucht es eine Trennung pro Herstellerin?**
Befund: Rollen `user`/`bearbeiter`/`admin`; Marina sieht Saskias Zahlen und
umgekehrt. Ist das gewollt?
Antwort: Ja, eventuell anpassen?

---

## Teil B – Verbesserungen ohne Rückfrage

Diese Punkte brauchen keine fachliche Entscheidung, nur Priorisierung.

| # | Thema | Vorschlag | Aufwand |
|---|-------|-----------|---------|
| V1 | Audit | Audit-Trigger auch auf `Rechnung`, `Lieferschein`, `Kunde` (heute nur `Schmuckstück`, `0005_…sql:39`) | M |
| V2 | CI | Playwright-E2E (`e2e/`) in `tests.yml` aufnehmen; läuft heute nur lokal | M |
| V3 | Betrieb | Log-Rotation (`logging: max-size`) in allen Compose-Dateien | S |
| V4 | Betrieb | Image-Tags genauer pinnen (`postgres:16-alpine`, `node:22-alpine`, `caddy:2-alpine` sind nur Major) | S |
| V5 | Abhängigkeiten | Dependabot auch für `/backend`, `/frontend`, `/mcp-server` und `docker` | S |
| V6 | Versionierung | Versionsschema festlegen (`package.json` 1.0.0 vs. Tag-Beispiel 0.3.0), `CHANGELOG.md` | S |
| V7 | Doku | Kurzes **Benutzerhandbuch** für Marina und Saskia (Ablauf Stück → Lieferschein → Rechnung, Messe-Import, Backup) | M |
| V8 | Doku | Glossar (Auslagern, Restock, Ausschuss, Basis-Artikelnummer …) | S |
| V9 | Doku | `scripts/README.md` und Erwähnung von `mcp-server/` im Haupt-README | S |
| V10 | Barrierefreiheit | Grundlegende `aria`-/Label-Prüfung (heute ~22 `aria-*` im ganzen Frontend) | M |

## Teil C – Doku-Hygiene (übersehen)

- **`CLAUDE.md` widerspricht sich:** Der Block „Ausnahme: Dynamische Werte …“
  steht zweimal; einmal heißt es „in `styles/<seite>.css`“, einmal „in
  `index.css`“. Laut Regel ist `index.css` nur Import-Liste → zweiten Block
  streichen (eigener `docs:`-Commit).
- **Root-Dokumente sind veraltet:** `AUDIT_LOGIK_DATENBANK.md` (Stand `b06aaf7`)
  hat keine Status-Spalte; mehrere Befunde sind behoben (B1 Geld als `NUMERIC`
  per Migration 0003, B4 `UNIQUE` auf `Rechnung.ID`, E8 Healthcheck). Die
  Randnotiz, `graphify-out/` fehle, stimmt nicht mehr.
  `TESTPLAN_VERBESSERUNG.md` nennt 27+2 Testdateien. `TECHNOLOGIE.md` spricht
  von Nginx, ausgeliefert wird per Express.
  Vorschlag: nach `docs/archiv/` verschieben oder je Befund „offen/behoben“
  ergänzen.
- **Drei Sicherungswege, keine Übersicht:** Der JSON-/SQL-Export der Oberfläche
  enthält keine Fotos (README), der vollständige `pg_dump` in `db/backup.sh`
  dagegen schon (BYTEA). Eine Tabelle „welche Sicherung enthält was, wie
  zurückspielen“ fehlt.
- **`mcp-server/`** verlangt Node ≥ 18, der Rest ≥ 22.

---

## Nächster Schritt

Nach Rückmeldung zu den P1-Fragen (F1–F8, F19–F21) schreibe ich daraus
User Stories mit Akzeptanzkriterien und lege je Story ein Issue an.
