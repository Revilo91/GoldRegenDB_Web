# Etikett-Größen

## Einzige Quelle

Alle Etikettengrößen stehen in `backend/src/routes/etiketten.js` unter `LABEL_SIZES`.
Das Frontend lädt sie über `GET /api/etiketten/sizes` – eine neue Größe muss also
**nur an dieser einen Stelle** eingetragen werden.

```javascript
const LABEL_SIZES = {
  small: { id: "small", name: "Klein", w: 30, h: 20,
           rotate: false, showQr: false, brandH: 4, artSize: 5,   hintSize: 2.2 },
  large: { id: "large", name: "Groß",  w: 40, h: 30,
           rotate: true,  showQr: true,  brandH: 8, artSize: 8,   hintSize: 3.5 },
};
```

| Feld | Bedeutung |
|------|-----------|
| `id` | Schlüssel, den das Frontend als `labelSize` sendet |
| `name` | Anzeigename in der Größenauswahl |
| `w`, `h` | Physische Maße in mm (Querformat, wie im Drucker eingelegt) |
| `rotate` | `true` = Inhalt wird 90° gedreht gesetzt (Hängeetikett) |
| `showQr` | `false` = kein QR-Code, wenn das Etikett zum Scannen zu klein ist |
| `brandH` | Höhe des Logobereichs in mm |
| `artSize` | Basis-Schriftgröße der Artikelnummer in mm |
| `hintSize` | Basis-Schriftgröße der Materialhinweise in mm |

Alle Werte sind Zahlen ohne Einheit – die Route hängt `mm` an.

## Neue Größe hinzufügen

Einen Eintrag in `LABEL_SIZES` ergänzen. Fertig. Größenauswahl, Vorschau,
`@page`-Format und Druck ziehen die Werte automatisch nach.

Faustregeln für die Proportionen:

- `artSize` ≈ 25 % der kurzen Etikettkante
- `hintSize` ≈ 70 % von `artSize`
- `brandH` ≈ 20 % der langen Etikettkante

## Layout

`backend/src/assets/etiketten-print.css` ist ein Template mit Platzhaltern,
die `buildPrintCss()` ersetzt: `{{LABEL_W}}`, `{{LABEL_H}}`, `{{CONTENT_W}}`,
`{{CONTENT_H}}`, `{{BRAND_H}}`, `{{ART_SIZE}}`, `{{HINT_SIZE}}`.

Aufbau des Etiketts von oben nach unten:

1. Logo (`brandH` hoch)
2. Gepunktete Trennlinie
3. Artikelnummer (zentriert, Basisnummer ohne `_`-Suffix)
4. Materialhinweise (2 Spalten × 3 Zeilen, max. 6)
5. Fußzeile mit Warnsymbol und – falls `showQr` – QR-Code

Abstände (`--gap`) und Symbolgröße (`--icon-size`) sind proportional zur
Inhaltsbox definiert, damit jede Größe mit demselben Aufbau auskommt, ohne
dass Inhalte abgeschnitten werden.

**Bei `rotate: true`** wird der Inhalt in einer um 90° getauschten Box
(`CONTENT_W` = `h`, `CONTENT_H` = `w`) gesetzt und gedreht.

## Vorschau und Druck sind identisch

`POST /api/etiketten/preview` kennt zwei Modi:

| `mode` | Ergebnis |
|--------|----------|
| `print` (Standard) | Alle Etiketten, je eines pro Druckseite (`@page`) |
| `single` | Genau ein Etikett, skaliert sich im iframe der Druckvorschau |

Beide Modi rendern dasselbe Markup mit demselben CSS – die Bildschirmvorschau
zeigt also das physische Etikett inklusive Drehung, nicht eine Bildschirmvariante
davon. Im Modus `single` ohne Artikel wird ein Musteretikett erzeugt, damit sich
Größe und Hinweise vorab beurteilen lassen.

Die Vorschau meldet ihren berechneten Maßstab per `postMessage` an die App und
nimmt umgekehrt `{ type: "etikett-size-mode", mode: "fit" | "actual" }` entgegen,
um zwischen „Einpassen“ und „Originalgröße“ (1:1) umzuschalten.
