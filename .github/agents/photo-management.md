# Photo Asset Management Skill

## Overview

Jewelry photos and order reference photos live in PostgreSQL (Issue #208). There
is no upload directory and no Docker volume for photos (Issue #214).

## Core Concepts

### Storage

- **Table `"Foto"`**: one photo per **base article number** (`MHO123` serves
  `MHO123_1`, `MHO123_2`, …). Columns `Artikelnummer` (PK), `Daten` (BYTEA),
  `MimeType`, `Groesse`, `Geaendert`. No foreign key to `"Schmuckstück"`: the
  base number usually has no row of its own, and the create form uploads the
  photo before the piece is saved.
- **Table `bestellung_foto`**: reference photos from the order form, keyed by
  `bestellung.foto_pfad`.
- `"Schmuckstück"` has **no** photo column. List, detail and inventory responses
  carry `hatFoto` (boolean, `EXISTS` on `"Foto"` via `hatFotoSql()`), so lists
  never load image data.

### Constraints

- Max 5 MB, JPG/PNG/GIF, type checked by magic bytes (not by extension)
- All reads and writes go through `backend/src/utils/fotoService.js`

## Key Files

- `backend/src/utils/fotoService.js` – validation, upsert, delete, ETag delivery, `hatFotoSql()`
- `backend/src/routes/schmuckstuecke.js` – upload/retrieve/delete endpoints
- `backend/src/utils/fotoZip.js` – photo ZIP export/import
- `backend/scripts/import-fotos.js` – one-off import of a photo folder (#209)
- `frontend/src/components/PhotoUpload.jsx`, `TablePhoto.jsx` – UI
- `frontend/src/api.js` – `uploadFoto`, `loadPhotoAsDataUrl` (cache keyed by base article number)

## Endpoints

| Method | Path | Notes |
| ------ | ---- | ----- |
| POST   | `/api/schmuckstuecke/upload?artikelnummer=` | multipart field `foto`, `multer.memoryStorage()`, stored under the base number |
| GET    | `/api/schmuckstuecke/foto/:fileName` | `MHO123_1` and `MHO123.jpg` both resolve to `MHO123`; ETag from `Geaendert`, 304 on `If-None-Match`; 404 without a DB entry |
| DELETE | `/api/schmuckstuecke/foto/:fileName` | bearbeiter/admin; 404 if nothing was deleted |
| GET    | `/api/backup/export-fotos` | streamed ZIP of all photos |
| POST   | `/api/backup/import-fotos-zip` | background job, progress via `/api/backup/import-fotos-jobs/:jobId` |

## Frontend Usage

```jsx
<TablePhoto hatFoto={row.hatFoto} artikelnummer={row.Artikelnummer} />

<PhotoUpload
  artikelnummer={form.Artikelnummer}
  hatFoto={form.hatFoto}
  onPhotoSelected={() => setForm({ ...form, hatFoto: true })}
/>
```

## Backup

Photos are **not** part of the JSON backup (base64 would exceed the 100 MB body
limit). Use the photo ZIP in the Datensicherung page. `db/backup.sh`
(`pg_dump`) contains the photo tables as well.

## Related Skills

- [Inventory Management](./inventory-management.md)
- [Backup & Recovery](./backup-recovery.md)
- [Testing & Quality](./testing.md)

## Troubleshooting

- **400 on upload**: magic-byte or size check in `fotoService.js` failed
- **Photo not showing**: check `SELECT 1 FROM "Foto" WHERE "Artikelnummer" = '<BASIS>'`;
  `hatFoto` is false without a row
- **Large ZIP import aborts**: Node ends requests after `server.requestTimeout`
  (300 s), reverse proxies often earlier – raise timeout and body limit there
