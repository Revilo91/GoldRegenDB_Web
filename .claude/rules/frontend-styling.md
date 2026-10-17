---
paths:
  - "frontend/src/**"
---

# Frontend-Styling (React)

**Strikte Regel: Keine Inline-Styles**
```jsx
// ❌ VERBOTEN
<div style={{ marginTop: 24, display: "flex" }}>

// ✅ ERFORDERLICH
<div className="my-container">
```

Alle Styles gehören als Klassendefinitionen in die passende Datei unter `frontend/src/styles/` (`<seite>.css`, Basis: `variables.css`, `layout.css`, `buttons.css`, `forms.css`, `modal.css` …). `frontend/src/index.css` ist nur die Import-Liste; die Reihenfolge der `@import`s bildet die Kaskade ab und darf nicht verändert werden. Neue Dateien am Ende einhängen, keine Datei über ca. 400 Zeilen.

**Ausnahme:** Dynamische Werte (aus Daten/State berechnet) nur als CSS-Variable: `style={{ "--balken-breite": `${x}%` }}` mit `width: var(--balken-breite)` in der Klasse. Bedingte Styles zwischen festen Werten sind bedingte Klassennamen, keine Variablen. ESLint (`no-restricted-syntax`) erzwingt das.
**Klassennamen** je Seite/Komponente einheitlich präfixiert (`inventur-…`, `dashboard-…`, `docmgr-…`) und in der jeweiligen `styles/<seite>.css` in einem eigenen kommentierten Block gruppiert; vorhandene Klassen (z. B. `cursor-pointer`, `mr-8`) wiederverwenden. Ein doppelter Klassenname im Selektor (`.a.a`) hebt die Spezifität, wo eine bestehende Regel sonst gewinnt.
