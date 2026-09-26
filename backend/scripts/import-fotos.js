#!/usr/bin/env node

// Einmaliger Bestandsimport (#209): Bilder aus einem Ordner in die Tabelle "Foto".
// Aufruf: npm run import:fotos -- --dir <pfad> [--dry-run] [--overwrite] [--log <datei>]

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { getSecret } = require("../src/config/secrets");
const logger = require("../src/utils/logger");
const { MAX_FOTO_BYTES, FotoFehler, pruefeBild, speichereFoto } = require("../src/utils/fotoService");
const { analysiereDateiname } = require("../src/utils/fotoDateiname");

const KOMPONENTE = "IMPORT-FOTOS";
const AUFRUF = "npm run import:fotos -- --dir <pfad> [--dry-run] [--overwrite] [--log <datei>]";

// Reihenfolge = Reihenfolge in Zusammenfassung und Log-Datei.
const GRUENDE = {
  mehrere: "mehrere Artikelnummern im Namen",
  ohneNummer: "keine Artikelnummer im Namen",
  unklar: "Name nicht eindeutig",
  endung: "unerlaubte Endung",
  duplikat: "mehrere Dateien für dieselbe Artikelnummer",
  existiertNicht: "Artikelnummer existiert nicht",
  vorhanden: "Foto bereits vorhanden",
  zuGross: "größer als 5 MB",
  keinBild: "keine gültigen Bilddaten",
};

function gruppiereNachBasis(dateien, ueberspringe) {
  const proBasis = new Map();
  for (const datei of dateien) {
    const ergebnis = analysiereDateiname(datei);
    if (ergebnis.status !== "ok") {
      ueberspringe(datei, ergebnis.status, ergebnis.nummern?.join(", "));
      continue;
    }
    if (!proBasis.has(ergebnis.basis)) proBasis.set(ergebnis.basis, []);
    proBasis.get(ergebnis.basis).push(datei);
  }

  const kandidaten = [];
  for (const [basis, gruppe] of proBasis) {
    if (gruppe.length === 1) {
      kandidaten.push({ basis, datei: gruppe[0] });
    } else {
      for (const datei of gruppe) ueberspringe(datei, "duplikat", gruppe.join(", "));
    }
  }
  return kandidaten;
}

async function importiereFotos({ client, dir, dryRun = false, overwrite = false }) {
  const importiert = [];
  const uebersprungen = [];
  const fehler = [];
  const ueberspringe = (datei, grund, detail) => uebersprungen.push({ datei, grund, detail });

  const dateien = fs.readdirSync(dir, { withFileTypes: true })
    .filter((eintrag) => eintrag.isFile())
    .map((eintrag) => eintrag.name)
    .sort();
  const kandidaten = gruppiereNachBasis(dateien, ueberspringe);

  const basen = kandidaten.map((k) => k.basis);
  const { rows: bekannt } = await client.query(
    `SELECT DISTINCT upper(split_part("Artikelnummer", '_', 1)) AS basis
       FROM "Schmuckstück" WHERE upper(split_part("Artikelnummer", '_', 1)) = ANY($1)`,
    [basen],
  );
  const { rows: mitFoto } = await client.query(
    'SELECT "Artikelnummer" FROM "Foto" WHERE "Artikelnummer" = ANY($1)',
    [basen],
  );
  const existiert = new Set(bekannt.map((r) => r.basis));
  const hatFoto = new Set(mitFoto.map((r) => r.Artikelnummer));

  for (const { basis, datei } of kandidaten) {
    if (!existiert.has(basis)) {
      ueberspringe(datei, "existiertNicht", basis);
      continue;
    }
    if (hatFoto.has(basis) && !overwrite) {
      ueberspringe(datei, "vorhanden", basis);
      continue;
    }
    try {
      const pfad = path.join(dir, datei);
      const { size } = fs.statSync(pfad);
      if (size > MAX_FOTO_BYTES) {
        ueberspringe(datei, "zuGross", `${(size / 1024 / 1024).toFixed(1)} MB`);
        continue;
      }
      const buffer = fs.readFileSync(pfad);
      pruefeBild(buffer);
      if (!dryRun) await speichereFoto(client, "schmuckstueck", basis, buffer);
      importiert.push({ datei, basis, ersetzt: hatFoto.has(basis) });
    } catch (err) {
      if (err instanceof FotoFehler) {
        ueberspringe(datei, "keinBild", err.message);
      } else {
        fehler.push({ datei, meldung: err.message });
      }
    }
  }

  return { importiert, uebersprungen, fehler };
}

function logZeilen({ uebersprungen, fehler }) {
  const reihenfolge = Object.keys(GRUENDE);
  // Stabil sortiert: innerhalb eines Grundes bleibt die Dateireihenfolge.
  const sortiert = [...uebersprungen].sort((a, b) => reihenfolge.indexOf(a.grund) - reihenfolge.indexOf(b.grund));
  return [
    ...sortiert.map(({ datei, grund, detail }) => [datei, GRUENDE[grund], detail || ""].join("\t")),
    ...fehler.map(({ datei, meldung }) => [datei, "Fehler", meldung].join("\t")),
  ];
}

function logZusammenfassung({ importiert, uebersprungen, fehler }, dryRun) {
  const ersetzt = importiert.filter((i) => i.ersetzt).length;
  const verb = dryRun ? "Würde importieren" : "Importiert";
  logger.info(KOMPONENTE, `${verb}: ${importiert.length}${ersetzt ? ` (davon ersetzt: ${ersetzt})` : ""}`);
  logger.info(KOMPONENTE, `Übersprungen: ${uebersprungen.length}`);
  for (const [grund, text] of Object.entries(GRUENDE)) {
    const anzahl = uebersprungen.filter((u) => u.grund === grund).length;
    if (anzahl > 0) logger.info(KOMPONENTE, `  ${text}: ${anzahl}`);
  }
  for (const { datei, meldung } of fehler) {
    logger.error(KOMPONENTE, `Fehler bei ${datei}`, { message: meldung });
  }
  logger.info(KOMPONENTE, `Fehler: ${fehler.length}`);
}

async function verbinde(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return { pool, client: await pool.connect() };
  } catch (error) {
    // Lokal gestartet, aber DATABASE_URL zeigt auf den Compose-Host "db".
    const dnsFehler = error.code === "EAI_AGAIN" || error.code === "ENOTFOUND";
    if (!dnsFehler || !/@db(?=[:/])/.test(databaseUrl)) throw error;
    await pool.end().catch(() => {});
    logger.warn(KOMPONENTE, "Host 'db' nicht auflösbar, versuche 'localhost'");
    return verbinde(databaseUrl.replace(/@db(?=[:/])/, "@localhost"));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      log: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
    },
  });
  // npm run wechselt ins Paketverzeichnis; relative Pfade gelten ab dem Aufrufort.
  const aufrufOrt = process.env.INIT_CWD || process.cwd();
  if (!values.dir) {
    logger.error(KOMPONENTE, `--dir fehlt. Aufruf: ${AUFRUF}`);
    process.exitCode = 1;
    return;
  }
  const dir = path.resolve(aufrufOrt, values.dir);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    logger.error(KOMPONENTE, `Ordner nicht gefunden: ${dir}`);
    process.exitCode = 1;
    return;
  }
  const datum = new Date().toLocaleDateString("sv-SE");
  const logPfad = path.resolve(aufrufOrt, values.log || `import-fotos-${datum}.log`);

  dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const databaseUrl = getSecret("DATABASE_URL");
  if (!databaseUrl) {
    logger.error(KOMPONENTE, "DATABASE_URL ist nicht gesetzt. Bitte .env prüfen.");
    process.exitCode = 1;
    return;
  }

  const dryRun = values["dry-run"];
  const { pool, client } = await verbinde(databaseUrl);
  try {
    logger.info(KOMPONENTE, `Lese ${dir}${dryRun ? " (Dry-Run, es wird nichts geschrieben)" : ""}`);
    const ergebnis = await importiereFotos({ client, dir, dryRun, overwrite: values.overwrite });
    const kopf = `# import-fotos ${new Date().toISOString()} dir=${dir} `
      + `dry-run=${dryRun} overwrite=${values.overwrite}`;
    fs.writeFileSync(logPfad, [kopf, ...logZeilen(ergebnis)].join("\n") + "\n");
    logZusammenfassung(ergebnis, dryRun);
    logger.info(KOMPONENTE, `Übersprungene Dateien: ${logPfad}`);
    if (ergebnis.fehler.length > 0) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(KOMPONENTE, "Import abgebrochen", { message: error.message });
    process.exitCode = 1;
  });
}

module.exports = { importiereFotos, logZeilen, GRUENDE };
