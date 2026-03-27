# API-Dokumentation: Lager-Inventur-Entwürfe

**Basisroute:** `/api/lagerinventur`

## Endpunkte

### GET `/drafts`
Alle eigenen Entwürfe (status=entwurf) abrufen.

### GET `/drafts/:id`
Einzelnen Entwurf abrufen (nur eigener Entwurf).

### POST `/drafts`
Neuen Entwurf anlegen.
- Body: `{ data: { [artikelnummer]: anzahl, ... }, kommentar?: string }`

### PUT `/drafts/:id`
Entwurf aktualisieren (nur solange status=entwurf).
- Body: `{ data: { ... }, kommentar?: string }`

### POST `/drafts/:id/complete`
Entwurf abschließen (status → abgeschlossen).

---

- Nur für bearbeiter/admin
- Datenfeld ist ein JSON-Objekt mit gezählten Stückzahlen pro Artikelnummer
- Status: `entwurf` oder `abgeschlossen`
- Entwürfe können später fortgesetzt oder abgeschlossen werden
