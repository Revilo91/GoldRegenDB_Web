#!/usr/bin/env node

// DSGVO-Löschkonzept für die Bestellübersicht (Art. 17 DSGVO).
// Anonymisiert Kundendaten (bestellung_kunde), sobald die gesetzliche/vertragliche
// Aufbewahrungsfrist abgelaufen ist. Die Transaktionsdaten (bestellung) bleiben erhalten.
//
// Fristen:
//   - Ohne Rechnung (nie zum Kauf geführt): BESTELLUNG_RETENTION_TAGE_OHNE_RECHNUNG Tage
//     nach Erfassung, nur wenn status IN ('storniert', 'abgeschlossen').
//   - Mit Rechnung: BESTELLUNG_RETENTION_JAHRE_MIT_RECHNUNG Jahre (§ 147 AO, § 257 HGB).
//
// Aufruf: npm run dsgvo:retention [-- --dry-run]

const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { getSecret } = require("../src/config/secrets");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const databaseUrl = getSecret("DATABASE_URL");
const retentionTageOhneRechnung = parseInt(process.env.BESTELLUNG_RETENTION_TAGE_OHNE_RECHNUNG || "90", 10);
const retentionJahreMitRechnung = parseInt(process.env.BESTELLUNG_RETENTION_JAHRE_MIT_RECHNUNG || "10", 10);

if (!databaseUrl) {
  console.error("❌ DATABASE_URL ist nicht gesetzt. Bitte .env prüfen.");
  process.exit(1);
}

async function findCandidates(client) {
  const { rows } = await client.query(
    `SELECT b.id, b.bestellnummer, b.erfassungsdatum, b.status, b.rechnung_nummer, k.id AS kunde_id, k.kunde_pseudonym
     FROM bestellung b
     JOIN bestellung_kunde k ON k.id = b.kunde_id
     WHERE k.anonymisiert = FALSE
       AND (
         (b.rechnung_nummer IS NULL AND b.status IN ('storniert', 'abgeschlossen')
            AND b.erfassungsdatum < NOW() - ($1 || ' days')::INTERVAL)
         OR
         (b.rechnung_nummer IS NOT NULL
            AND b.erfassungsdatum < NOW() - ($2 || ' years')::INTERVAL)
       )
     ORDER BY b.erfassungsdatum ASC`,
    [retentionTageOhneRechnung, retentionJahreMitRechnung]
  );
  return rows;
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const candidates = await findCandidates(client);

    console.log(`📋 Fristen: ${retentionTageOhneRechnung} Tage (ohne Rechnung) / ${retentionJahreMitRechnung} Jahre (mit Rechnung)`);
    console.log(`🔎 Kandidaten zur Anonymisierung: ${candidates.length}`);

    for (const c of candidates) {
      console.log(`  - ${c.bestellnummer} (Kunde ${c.kunde_pseudonym}, erfasst ${c.erfassungsdatum.toISOString().slice(0, 10)}, status=${c.status}, rechnung=${c.rechnung_nummer || "-"})`);
    }

    if (candidates.length === 0) {
      console.log("✅ Keine Anonymisierung erforderlich.");
      return;
    }

    if (dryRun) {
      console.log("\nDry-Run aktiv. Keine Änderungen geschrieben.");
      return;
    }

    let anonymisiert = 0;
    for (const c of candidates) {
      await client.query("SELECT anonymisiere_bestellung_kunde($1)", [c.kunde_id]);
      anonymisiert += 1;
    }

    console.log(`\n✅ ${anonymisiert} Kundendatensätze anonymisiert.`);
  } catch (error) {
    console.error("❌ Fehler bei der DSGVO-Retention:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ Unerwarteter Fehler:", error.message);
  process.exit(1);
});
