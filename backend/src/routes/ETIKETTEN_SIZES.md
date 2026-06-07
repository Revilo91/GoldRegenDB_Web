# Etikett-Größen Dokumentation

## Übersicht

Die Etikett-Größen sind zentral in `etiketten.js` unter `LABEL_SIZE_DEFAULTS` definiert. Jede Größe skaliert proportional.

## Größendefinitionen

```javascript
const LABEL_SIZE_DEFAULTS = {
  "extra-small": { w: "30mm", h: "20mm", brandH: "5mm", artSize: "5mm", hintSize: "2.2mm" },
  "small":       { w: "48mm", h: "30mm", brandH: "8mm", artSize: "8mm", hintSize: "3.5mm" },
  "medium":      { w: "60mm", h: "36mm", brandH: "10mm", artSize: "10mm", hintSize: "4mm" },
  "large":       { w: "80mm", h: "48mm", brandH: "14mm", artSize: "14mm", hintSize: "5mm" },
};
```

### Parameter-Erklärung

| Parameter | Beschreibung |
|-----------|-------------|
| `w` | Breite des Etiketts |
| `h` | Höhe des Etiketts |
| `brandH` | Höhe des Logo/Brand-Bereichs |
| `artSize` | Schriftgröße der Artikelnummer |
| `hintSize` | Schriftgröße der Material-Hinweise |

## Neue Größe Hinzufügen

### Schritt 1: Backend (`backend/src/routes/etiketten.js`)

Neue Größe zu `LABEL_SIZE_DEFAULTS` hinzufügen:

```javascript
const LABEL_SIZE_DEFAULTS = {
  // ... existing sizes ...
  "custom": {
    w: "XXmm",
    h: "YYmm",
    brandH: "Zmm",
    artSize: "Amm",
    hintSize: "Bmm",
  },
};
```

### Schritt 2: Frontend (`frontend/src/pages/Etiketten.jsx`)

Radio-Button für neue Größe hinzufügen:

```jsx
<label className="flex-row-center">
  <input
    type="radio"
    name="labelSize"
    value="custom"
    checked={labelSize === "custom"}
    onChange={(e) => setLabelSize(e.target.value)}
  />
  <span>Name (XX × YY mm)</span>
</label>
```

### Schritt 3: CSS-Variablen (`frontend/src/index.css`)

CSS-Variablen für die neue Größe dokumentieren (optional, für Preview):

```css
--label-custom-w: XXmm;
--label-custom-h: YYmm;
--label-custom-brandH: Zmm;
--label-custom-artSize: Amm;
--label-custom-hintSize: Bmm;
```

## Proportionale Skalierung

Die Größen folgen einer proportionalen Skalierung:

- **extra-small**: 30×20 mm (kleinste Größe, kompakt)
- **small**: 48×30 mm (Standard klein)
- **medium**: 60×36 mm (Standard mittel)
- **large**: 80×48 mm (größte Größe, für mehr Details)

Bei der Skalierung sollten folgende Verhältnisse beachtet werden:
- `artSize` sollte 10-15% der Etiketthöhe sein
- `hintSize` sollte etwa 70% von `artSize` sein
- `brandH` sollte etwa 20-25% der Etiketthöhe sein

## Layout-Struktur

Das Etikett wird **90° gedreht** gedruckt und enthält folgende Elemente (von oben nach unten):

1. **Logo-Bereich** (`brandH` hoch)
2. **Gepunktete Linie** (Trennlinie)
3. **Artikelnummer** (zentriert)
4. **Material-Hinweise** (2-spaltig, max. 6 Zeilen)
5. **Unten-Bereich** (Warnsymbol + QR-Code)

Siehe `etiketten-print.css` für Details der CSS-Struktur.

## Hilfsfunktionen

### Größe auflösen
```javascript
const sizeConfig = resolveLabelSize("small", cssContent);
// Gibt: { w: "48mm", h: "30mm", brandH: "8mm", artSize: "8mm", hintSize: "3.5mm" }
```

### CSS-Variable lesen
```javascript
const value = getCssVar(cssContent, "--label-small-w", "48mm");
```

## Tests

Alle Größen sollten im Frontend überprüft werden:
1. Öffne `POST /api/etiketten/preview`
2. Wähle verschiedene Größen
3. Prüfe, dass Text, Logo und QR-Code proportional skalieren
