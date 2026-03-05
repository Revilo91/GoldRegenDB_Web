#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const overwrite = args.includes("--overwrite");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const uploadsDir = path.resolve(__dirname, "../src/assets/uploads");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("❌ DATABASE_URL ist nicht gesetzt. Bitte .env prüfen.");
  process.exit(1);
}

if (!fs.existsSync(uploadsDir)) {
  console.error(`❌ Upload-Ordner nicht gefunden: ${uploadsDir}`);
  process.exit(1);
}

function normalizeBaseArtikelnummer(artikelnummer) {
  if (!artikelnummer) return "";
  return String(artikelnummer).split("_")[0].trim();
}

function createPhotoMap(files) {
  const allowedExt = new Set([".jpg", ".jpeg", ".png", ".gif"]);
  const map = new Map();
  const duplicates = new Map();

  const sorted = [...files].sort((a, b) => a.localeCompare(b, "de"));
  for (const fileName of sorted) {
    const ext = path.extname(fileName).toLowerCase();
    if (!allowedExt.has(ext)) continue;

    const base = path.parse(fileName).name;
    if (!base) continue;

    if (!map.has(base)) {
      map.set(base, fileName);
    } else {
      if (!duplicates.has(base)) {
        duplicates.set(base, [map.get(base)]);
      }
      duplicates.get(base).push(fileName);
    }
  }

  return { map, duplicates };
}

async function main() {
  const files = fs.readdirSync(uploadsDir);
  const { map: photoMap, duplicates } = createPhotoMap(files);

  if (duplicates.size > 0) {
    console.warn("⚠️ Mehrere Fotos mit gleicher Basis-Artikelnummer gefunden:");
    for (const [base, dupes] of duplicates.entries()) {
      console.warn(`  - ${base}: ${dupes.join(", ")}`);
    }
    console.warn("➡️ Es wird jeweils die alphabetisch erste Datei verwendet.\n");
  }

  let pool = new Pool({ connectionString: databaseUrl });
  let client;

  try {
    client = await pool.connect();
  } catch (error) {
    const isDnsError = error && (error.code === "EAI_AGAIN" || error.code === "ENOTFOUND");
    const canFallbackToLocalhost = /@db(?=[:/])/.test(databaseUrl);

    if (!isDnsError || !canFallbackToLocalhost) {
      throw error;
    }

    const fallbackUrl = databaseUrl.replace(/@db(?=[:/])/, "@localhost");
    console.warn("⚠️ Host 'db' konnte lokal nicht aufgelöst werden, versuche 'localhost'...");

    await pool.end().catch(() => {});
    pool = new Pool({ connectionString: fallbackUrl });
    client = await pool.connect();
  }

  try {
    const { rows } = await client.query(
      'SELECT "Artikelnummer", "Foto" FROM "Schmuckstück" ORDER BY "Artikelnummer"'
    );

    const updates = [];
    let withoutMatch = 0;

    for (const row of rows) {
      const artikelnummer = row.Artikelnummer;
      const currentPhoto = row.Foto || "";
      const baseArtikelnummer = normalizeBaseArtikelnummer(artikelnummer);
      const matchedPhoto = photoMap.get(baseArtikelnummer);

      if (!matchedPhoto) {
        withoutMatch += 1;
        continue;
      }

      if (!overwrite && currentPhoto.trim() !== "") {
        continue;
      }

      if (currentPhoto === matchedPhoto) {
        continue;
      }

      updates.push({ artikelnummer, matchedPhoto });
    }

    console.log(`📁 Upload-Dateien: ${photoMap.size}`);
    console.log(`🧾 Schmuckstücke gesamt: ${rows.length}`);
    console.log(`🔎 Ohne Dateitreffer: ${withoutMatch}`);
    console.log(`✍️ Zu aktualisieren: ${updates.length}`);

    if (dryRun || updates.length === 0) {
      if (dryRun) {
        console.log("\nDry-Run aktiv. Keine Änderungen geschrieben.");
      }
      return;
    }

    await client.query("BEGIN");
    for (const update of updates) {
      await client.query(
        'UPDATE "Schmuckstück" SET "Foto" = $1 WHERE "Artikelnummer" = $2',
        [update.matchedPhoto, update.artikelnummer]
      );
    }
    await client.query("COMMIT");

    console.log("\n✅ Foto-Spalte erfolgreich synchronisiert.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Fehler bei der Synchronisierung:", error.message);
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
