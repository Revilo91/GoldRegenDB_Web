# WHERE Clause Builder

Zentrale Utility-Klasse für konsistente und sichere WHERE-Clauses in allen API-Routes.

## Motivation

**Problem:** WHERE-Clauses waren über die gesamte Codebasis verstreut und inkonsistent:
- Verkauft-Filter manchmal mit, manchmal ohne Ausschuss-Prüfung
- Copy-Paste-Fehler zwischen verschiedenen Routes
- Geschäftslogik nicht zentral definiert
- SQL-Injection-Risiko bei manueller String-Konstruktion

**Lösung:** Zentraler WHERE-Clause-Builder mit klaren Standard-Filtern.

## Geschäftsregeln

Die folgenden Regeln sind im Builder implementiert und werden **in allen Routes einheitlich** durchgesetzt:

### Primär-Status

| Status | Regel | Bedeutung |
|--------|-------|-----------|
| **Verkauft** | `Verkauft = 1 AND Ausschuss = 0` | Erfolgreich verkauft (NICHT Ausschuss!) |
| **Ausschuss** | `Ausschuss = 1` | Ausschuss (unabhängig von Verkauft-Status) |
| **Verfügbar** | `Verkauft = 0 AND Ausschuss = 0 AND Ausgelagert = 0` | Im Lager, verfügbar für Verkauf |
| **Ausgelagert** | `Ausgelagert > 0` | Bei einem Kunden/Händler ausgelagert |
| **Aktiv Ausgelagert** | `Ausgelagert > 0 AND Verkauft = 0 AND Ausschuss = 0` | Beim Kunden, noch nicht verkauft |

### Wichtig: Verkauft ≠ Ausschuss

Ein Schmuckstück kann **niemals gleichzeitig** verkauft und Ausschuss sein.
- `verkauft()` schließt automatisch Ausschuss aus (`Ausschuss = 0`)
- `ausschuss()` ist unabhängig vom Verkauft-Status

## Verwendung

### Basis-Beispiel

```javascript
const { where } = require('../utils/whereClauseBuilder');

// Einfacher Filter
const builder = where();
builder.verfuegbar();

const query = `SELECT * FROM "Schmuckstück" ${builder.build()}`;
const result = await db.query(query, builder.getParams());
```

### Standard-Filter

```javascript
const builder = where();

// Status-Filter
builder.verkauft();           // Verkauft = 1 AND Ausschuss = 0
builder.ausschuss();          // Ausschuss = 1
builder.verfuegbar();         // Verkauft = 0 AND Ausschuss = 0 AND Ausgelagert = 0
builder.nichtVerkauft();      // Verkauft = 0
builder.keinAusschuss();      // Ausschuss = 0

// Auslagerungs-Filter
builder.ausgelagert();        // Ausgelagert > 0
builder.ausgelagert(5);       // Ausgelagert = 5 (bei Kunde ID 5)
builder.aktivAusgelagert();   // Ausgelagert > 0 AND Verkauft = 0 AND Ausschuss = 0
builder.aktivAusgelagert(5);  // Ausgelagert = 5 AND Verkauft = 0 AND Ausschuss = 0
builder.imLager();            // Ausgelagert = 0
```

### Artikelnummer-Filter

```javascript
const builder = where();

// Exakte Suche
builder.artikelnummer('MBH001');           // Artikelnummer = 'MBH001'

// Pattern-Suche
builder.artikelnummerLike('MBH%');         // Artikelnummer LIKE 'MBH%'

// IN-Clause
builder.artikelnummerIn(['MBH001', 'MBH002']); // Artikelnummer = ANY($1)

// Artikelnummer-Präfixe
builder.hersteller('M');                   // SUBSTRING(Artikelnummer, 1, 1) = 'M'
builder.grundmaterial('B');                // SUBSTRING(Artikelnummer, 2, 1) = 'B'
builder.produktart('H');                   // SUBSTRING(Artikelnummer, 3, 1) = 'H'
```

### Kombinierte Filter

```javascript
const builder = where();
builder.verfuegbar();            // Im Lager
builder.grundmaterial('P');      // Perlen
builder.produktart('A');         // Armband

// Ergibt: WHERE Verkauft = 0 AND Ausschuss = 0 AND Ausgelagert = 0
//               AND SUBSTRING("Artikelnummer", 2, 1) = $1
//               AND SUBSTRING("Artikelnummer", 3, 1) = $2
// Params: ['P', 'A']
```

### Lieferschein/Rechnung-Filter

```javascript
const builder = where();

builder.mitLieferschein();        // Lieferschein_ID > 0
builder.mitLieferschein(123);     // Lieferschein_ID = 123
builder.ohneLieferschein();       // Lieferschein_ID = 0

builder.mitRechnung();            // Rechnung_ID > 0
builder.mitRechnung(456);         // Rechnung_ID = 456
builder.ohneRechnung();           // Rechnung_ID = 0
```

### Generische Filter

```javascript
const builder = where();

// Spalte = Wert
builder.equals('Farbe', 'Rot');           // "Farbe" = 'Rot'

// Spalte LIKE Pattern
builder.like('Name', '%Perle%');          // "Name" LIKE '%Perle%'

// Spalte nicht leer
builder.notEmpty('Material');             // "Material" IS NOT NULL AND "Material" != ''
```

### Raw SQL (für komplexe Fälle)

```javascript
const builder = where();
builder.verfuegbar();

// Mehrere Spalten durchsuchen
const paramIdx = builder.getNextParamIdx();
builder.raw(
  `("Artikelnummer" ILIKE $${paramIdx} OR "Name" ILIKE $${paramIdx})`,
  '%Perle%'
);

// VORSICHT: Bei raw() muss Benutzer-Input separat validiert werden!
```

## API

### Konstruktor / Factory

```javascript
// Factory-Funktion (empfohlen)
const builder = where(startParamIdx = 1);

// Direkter Konstruktor
const builder = new WhereClauseBuilder(startParamIdx = 1);
```

### Ausgabe-Methoden

```javascript
// WHERE-Clause mit "WHERE" Keyword
builder.build();              // → "WHERE ..." oder ""

// Nur Bedingungen (ohne "WHERE")
builder.buildConditions();    // → "..." oder ""

// Parameter-Array für prepared statement
builder.getParams();          // → [param1, param2, ...]

// Nächster Parameter-Index (für weitere manuelle Parameter)
builder.getNextParamIdx();    // → number
```

### Hilfsfunktionen

```javascript
// Unabhängige Kopie erstellen
const builder2 = builder.clone();
```

## Beispiele aus den Routes

### Dashboard: Verkaufte Stücke

**Vorher:**
```javascript
COUNT(*) FILTER (WHERE "Verkauft" = 1) AS "soldPieces"
```

**Nachher:**
```javascript
// Konsistent überall: verkauft = 1 UND ausschuss = 0
COUNT(*) FILTER (WHERE "Verkauft" = 1 AND "Ausschuss" = 0) AS "soldPieces"
```

### SumUp Export: Verfügbare Artikel

**Vorher:**
```javascript
const { rows } = await db.query(
  `SELECT * FROM "Schmuckstück"
   WHERE "Ausgelagert" = 0 AND "Ausschuss" = 0 AND "Verkauft" = 0
   ORDER BY "Artikelnummer"`
);
```

**Nachher:**
```javascript
const builder = where();
builder.verfuegbar();

const { rows } = await db.query(
  `SELECT * FROM "Schmuckstück"
   ${builder.build()}
   ORDER BY "Artikelnummer"`,
  builder.getParams()
);
```

### Kunden: Ausgelagerte Artikel zurücklagern

**Vorher:**
```javascript
await db.query(
  'UPDATE "Schmuckstück" SET "Ausgelagert" = 0
   WHERE "Artikelnummer" = ANY($1) AND "Ausgelagert" = $2',
  [artikelnummern, kundeId]
);
```

**Nachher:**
```javascript
const builder = where();
builder.artikelnummerIn(artikelnummern);
builder.ausgelagert(kundeId);

await db.query(
  `UPDATE "Schmuckstück" SET "Ausgelagert" = 0 ${builder.build()}`,
  builder.getParams()
);
```

## Best Practices

1. **Nutze Standard-Filter wo möglich**
   ```javascript
   // ✅ Gut
   builder.verfuegbar();

   // ❌ Vermeiden
   builder.equals('Verkauft', 0).equals('Ausschuss', 0).equals('Ausgelagert', 0);
   ```

2. **Verkauft-Status immer mit Builder**
   ```javascript
   // ✅ Gut - korrekte Geschäftslogik (schließt Ausschuss aus)
   builder.verkauft();

   // ❌ Fehler - inkonsistent mit Geschäftslogik
   builder.equals('Verkauft', 1);
   ```

3. **Raw SQL sparsam verwenden**
   ```javascript
   // Raw SQL nur für komplexe Fälle nutzen
   // Bei Benutzer-Input IMMER validieren/sanitizen
   builder.raw('("Name" ILIKE $1 OR "Material" ILIKE $1)', search);
   ```

4. **Parameter-Index beachten**
   ```javascript
   const builder = where();
   builder.verfuegbar();
   builder.artikelnummer('MBH001');

   // Weitere Parameter nach dem Builder
   const nextIdx = builder.getNextParamIdx();
   const query = `SELECT * FROM "Schmuckstück"
                  ${builder.build()}
                  LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`;
   const params = [...builder.getParams(), limit, offset];
   ```

## Vorteile

✅ **Konsistenz** – Gleiche Geschäftslogik überall
✅ **Wartbarkeit** – Zentrale Stelle für Änderungen
✅ **SQL-Injection-Schutz** – Prepared Statements
✅ **Typsicherheit** – Keine String-Manipulation
✅ **Testbarkeit** – Separate Unit-Tests
✅ **Lesbarkeit** – `builder.verfuegbar()` statt SQL-String

## Migration

Die wichtigsten Routes wurden bereits migriert:
- ✅ `backend/src/routes/dashboard.js`
- ✅ `backend/src/routes/schmuckstuecke.js`
- ✅ `backend/src/routes/sumup.js`
- ✅ `backend/src/routes/kunden.js`
- ✅ `backend/src/routes/inventur.js`

Noch nicht migriert:
- ⏳ `backend/src/routes/lieferscheine.js`
- ⏳ `backend/src/routes/rechnungen.js`

## Tests

Vollständige Test-Suite: `backend/__tests__/whereClauseBuilder.test.js`

```bash
npm test -- whereClauseBuilder.test.js
```

38 Tests decken alle Standard-Filter, Kombinationen und Edge-Cases ab.
