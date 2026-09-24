# Ressourcen für die E-Rechnung (EN 16931)

Wird von `backend/src/utils/eRechnung/` zur Laufzeit gelesen. Alles liegt lokal, damit Erzeugung
und Prüfung ohne Internetzugang (z. B. auf der Synology) funktionieren.

| Pfad | Inhalt | Quelle / Lizenz |
|------|--------|-----------------|
| `xsd/*.xsd` | UN/CEFACT Cross Industry Invoice D16B (SCRDM Subset, uncoupled) | [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931) `validation-1.3.16`, © UN/CEFACT |
| `schematron/EN16931-CII-validation.sef.json.gz` | CEN-Schematron EN 16931 (CII) 1.3.16, kompiliert für SaxonJS | eInvoicing-EN16931, EUPL 1.2 |
| `schematron/XRechnung-CII-validation.sef.json.gz` | XRechnung-Schematron 2.6.0 (XRechnung 3.0.2) inkl. Peppol-BIS-3.0.21-Regeln, kompiliert mit SchXslt 1.10.1 für SaxonJS | [itplr-kosit/xrechnung-schematron](https://github.com/itplr-kosit/xrechnung-schematron), Apache 2.0 |
| `pdf/NotoSans-*.ttf` | Schrift für das ZUGFeRD-PDF (wie im Excel-Export; PDF/A verlangt eingebettete Schriften). Statische Schnitte aus `NotoSans[wdth,wght].ttf` (google/fonts), mit fontTools auf Latein (U+0020–024F, U+1E00–1EFF, Satzzeichen, €) reduziert – pdf-lib kann die ungekürzte Datei nicht korrekt einbetten | Noto Sans, SIL Open Font License 1.1 (`pdf/NotoSans-OFL.txt`) |
| `pdf/sRGB.icc` | sRGB-Farbprofil für den PDF/A-Output-Intent | littleCMS / Apache FOP, zlib-Lizenz (`pdf/sRGB.icc.LICENSE`) |
| `pdf/logo.png` | verkleinertes Logo (aus `../Logo trasparent weißer Kreis.png`) | Goldregen Schmuckdesign |

Die Kombination XSD + EN16931-Schematron + XRechnung-Schematron entspricht dem Szenario
„EN16931 XRechnung (CII)“ der offiziellen KoSIT-Validator-Konfiguration.

## Aktualisieren

Neue Regelversionen (z. B. neues XRechnung-Release) in `backend/scripts/build-erechnung-regeln.sh`
eintragen und ausführen:

```bash
cd backend && bash scripts/build-erechnung-regeln.sh
npm test -- eRechnung        # Beispielrechnungen müssen weiterhin fehlerfrei sein
```

Der CI-Job `erechnung-validator` prüft die erzeugten Beispielrechnungen zusätzlich mit dem echten
KoSIT-Validator und Mustang/veraPDF.
