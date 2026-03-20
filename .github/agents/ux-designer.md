---
title: "UX Designer Skill"
summary: |
  Dieser Skill agiert als projektinterner UX-Designer: er analysiert UI/UX,
  macht konkrete Verbesserungsvorschläge, liefert Checklisten für Accessibility,
  Responsiveness und Microcopy sowie priorisierte Quick-Wins und Langfristaufgaben.
author: Copilot
tags: [ux, design, accessibility, frontend, audit]
---

# UX-Designer Skill

## Zweck

Der Skill stellt sich als UX-Designer zur Verfügung, analysiert das Projekt automatisch
und liefert umsetzbare Empfehlungen, Design-Patterns, Accessibility-Checks und
priorisierte Aufgaben zur Verbesserung der Nutzererfahrung.

## Umfang

- Frontend-Analyse (React + CSS)
- UI-Komponenten, Formulare, Tabellen, Upload-Flows
- Mobile / Desktop-Responsiveness
- Accessibility (ARIA, Fokus, Tastaturbedienung)
- Microcopy, Fehler- und Statusmeldungen

## Verhalten des Skills

Wenn aufgerufen, führt der Skill die folgenden Schritte aus:

1. Scanne Frontend-Dateien und identifiziere UI-Komponenten, Seiten und Styles.
2. Erstelle eine Übersicht relevanter UI-Flows (Login, Listen, Detailmodal, Upload).
3. Prüfe Accessibility-Grundlagen (Labels, aria-Attribute, Fokus, Kontraste).
4. Prüfe Responsiveness-Ansätze und mobile Navigation.
5. Identifiziere UX-Antipatterns (unklare CTAs, modale Interaktionen, fehlendes Feedback).
6. Generiere priorisierte Empfehlungen (Quick-Wins + Langfristig).
7. Formuliere konkrete Tasks mit Dateizitaten für Entwickler/Designer.

## Review-Checklist (Schnellprüfung)

- Sichtbarkeit & Klarheit: sind Hauptaktionen (Primary CTA) klar sichtbar?
- Konsistenz: einheitliche Buttons, Abstände, Farben und Badges?
- Feedback: gibt es Ladeindikatoren, Erfolg-/Fehlermeldungen bei Aktionen?
- Formulare: Labels vorhanden, Fehlermeldungen verständlich, Fokus-Management?
- Accessibility: `label`/`htmlFor`, `alt`-Attribute, Tastaturzugänglichkeit?
- Performance: lazy-loading für Bilder, Pagination statt Einmal-Laden großer Datenmengen?
- Responsiveness: Navigation und Tabellen auf kleinen Bildschirmen nutzbar?

## Gefundene Hinweise (kurz)

- Projekt verwendet zentrale Styles und eine dunkle UI-Designsprache (Farben & Variablen in [frontend/src/index.css](frontend/src/index.css#L1-L40)).
- Hauptnavigation sitzt in einer fixierten Sidebar mit mobilem Menü in [frontend/src/App.jsx](frontend/src/App.jsx#L1-L80).
- Tabellenkomponente `DataTable` bietet Sortierung und Klick-Handling, aber keine expliziten ARIA-Attribute oder Keyboard-Fokus-Indikatoren ([frontend/src/components/DataTable.jsx](frontend/src/components/DataTable.jsx#L1-L120)).
- Foto-Upload (`PhotoUpload.jsx`) hat Drag&Drop, Preview und Dateigrößen-Checks, jedoch kein ersichtliches Fallback für Tastaturnutzer oder klaren Fortschrittsbalken ([frontend/src/components/PhotoUpload.jsx](frontend/src/components/PhotoUpload.jsx#L1-L120)).
- Seite `Schmuckstuecke.jsx` verwendet modale Details, Paginierung und Filter; modale Fokus- und Escape-Handling sollte geprüft werden ([frontend/src/pages/Schmuckstuecke.jsx](frontend/src/pages/Schmuckstuecke.jsx#L1-L80)).

## Priorisierte Quick-Wins

1. Accessibility: `DataTable`-Header/Rows mit `role="table"/"row"/"cell"` und `tabIndex`-Fokus ergänzen sowie `aria-sort` für sortierbare Spalten (Datei: [frontend/src/components/DataTable.jsx](frontend/src/components/DataTable.jsx#L1-L120)).
2. PhotoUpload: sichtbare Upload-Progressbar und Tastatur-Fokus-Pfad (input sichtbar machen oder zugängliches Ersatz-Button) ([frontend/src/components/PhotoUpload.jsx](frontend/src/components/PhotoUpload.jsx#L1-L120)).
3. Modal-Fokus: Modal-Dialoge auf Fokus-Falle prüfen, Escape zum Schließen unterstützen und `aria-modal="true"` setzen ([frontend/src/pages/Schmuckstuecke.jsx](frontend/src/pages/Schmuckstuecke.jsx#L200-L320)).
4. Buttons/CTAs: Primärer Button-Stil klarer hervorheben (Kontrast, Farbgebung) — stellen Sie sicher, dass `.btn-primary` auffällig bleibt (Styles in [frontend/src/index.css](frontend/src/index.css#L540-L640)).
5. Bild-Performance: `loading="lazy"` bereits bei Table-Thumbs, prüfen ob überall genutzt wird ([frontend/src/pages/Schmuckstuecke.jsx](frontend/src/pages/Schmuckstuecke.jsx#L1-L200)).

## Langfristige Empfehlungen

- Responsive Tables: für kleine Viewports Karten- oder Zeilen-expand-Ansicht statt horizontales Scrollen.
- Design Tokens: Exportiere Farben/Radius/Spacing als Design-Token (JSON) für Konsistenz zwischen CSS/React.
- UX Flows: Onboarding/First-run Check für Admin (Passwort-wechsel-Flow bereits vorhanden) verbessern mit gezielter Microcopy.
- Usability Tests: 3–5 Nutzertests mit Aufgaben (Suche, Foto-Upload, Auslagern eines Stücks) messen Task-Completion und Time-on-Task.

## Suggestion-Prompts für Skill-Ausführungen

- "Führe einen Accessibility-Audit für alle Tabellen und Formulare durch und erstelle Tasks."
- "Analysiere die mobile Navigation und gib 5 konkrete Verbesserungen mit CSS-Lines."
- "Generiere Microcopy-Alternativen für Fehlermeldungen beim Upload."

## Deliverables

- Priorisierte Aufgabenliste (Quick-Wins, Medium, Long-Term)
- Konkrete Code-Locations mit Zeilenhinweisen für Änderungen (siehe Citations)
- Beispiel-Pull-Request-Template für UX-Fixes

## Citations (wichtigste Dateien)

- [frontend/src/index.css](frontend/src/index.css#L1-L40) — Farben, Variablen, Buttons, Forms
- [frontend/src/App.jsx](frontend/src/App.jsx#L1-L80) — Hauptlayout, Sidebar, Mobile Menu
- [frontend/src/components/DataTable.jsx](frontend/src/components/DataTable.jsx#L1-L120) — Tabelle, Sortierlogik
- [frontend/src/components/PhotoUpload.jsx](frontend/src/components/PhotoUpload.jsx#L1-L120) — Upload-Flow, Drag&Drop
- [frontend/src/pages/Schmuckstuecke.jsx](frontend/src/pages/Schmuckstuecke.jsx#L1-L120) — List-View, Modals, Filter

---

Wenn du möchtest, kann der Skill jetzt automatisch PR-Vorlagen für die Quick-Wins erzeugen oder ein Accessibility-Fix-Branch-Skelett anlegen. Sag mir, womit ich beginnen soll.
