---
paths:
  - "backend/src/utils/foto*.js"
  - "backend/src/routes/schmuckstuecke/**"
  - "backend/src/routes/backup/**"
  - "backend/scripts/*fotos*.js"
  - "frontend/src/utils/sqlDump.js"
  - "frontend/src/components/*Photo*.jsx"
---

# Fotos

- Fotos liegen **in PostgreSQL**: Tabelle `"Foto"` (Schmuckstücke, Schlüssel = Basis-Artikelnummer, `MHO123` gilt für `MHO123_1`, `MHO123_2`) und `bestellung_foto` (Bestellformular)
- Lesen/Schreiben nur über `backend/src/utils/fotoService.js`; Listen prüfen per `EXISTS`, damit keine BYTEA-Daten geladen werden
- Liste, Detail und Inventur liefern je Stück `hatFoto` (boolean via `hatFotoSql()`); das Frontend lädt das Bild über die Artikelnummer
- Max. 5 MB (jpg/png/gif), Typ per Magic Bytes geprüft, nicht per Dateiendung
- Upload: `multer.memoryStorage()` in `schmuckstuecke.js`; Auslieferung mit ETag aus `Geaendert` und `Cache-Control: private, max-age=60`
- Fotos werden per **eigenem Foto-ZIP** gesichert (`utils/fotoZip.js`), nicht über den JSON-Export: `GET /api/backup/export-fotos` (REPEATABLE-READ-Snapshot), `POST /api/backup/import-fotos-zip` (Hintergrund-Job, Fortschritt: `GET /api/backup/import-fotos-jobs/:id`)
- **SQL-Dump:** `GET /api/backup/export-sql` exportiert als COPY-Blöcke. `frontend/src/utils/sqlDump.js` liest beim Import nur COPY-Blöcke und schickt sie an `POST /api/backup/import` — SQL wird nie direkt ausgeführt
- **Kein Datei-Fallback:** Fotos kommen nur aus der Datenbank; ohne Eintrag antwortet `GET /foto/:name` mit 404
