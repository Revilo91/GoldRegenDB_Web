#!/usr/bin/env node

// Sammelt Bilder mit Artikelnummer im Namen aus einem Ablage-Ordner in einen
// flachen Zielordner, der danach mit import-fotos.js eingelesen wird.
// Gelesen werden die Dateien direkt im Quellordner und alle Ordner, deren Name
// mit "_" beginnt (rekursiv).
// Aufruf: npm run sammle:fotos -- --quelle <pfad|smb://…> --ziel <pfad> [--dry-run]

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { parseArgs } = require("util");
const logger = require("../src/utils/logger");
const { analysiereDateiname } = require("../src/utils/fotoDateiname");

const KOMPONENTE = "SAMMLE-FOTOS";
const AUFRUF = "npm run sammle:fotos -- --quelle <pfad|smb://…> --ziel <pfad> [--dry-run]";
const MANUELL = "_manuell";
// Alle Artikelnummern haben die Form ABC123; engere Prüfung als im Import,
// damit Namen wie "S1.jpg" oder "IMG1234.jpg" nicht als Nummer durchgehen.
const ARTIKELNUMMER = /(?<![A-Z0-9])[A-Z]{3}\d{3}(?!\d)/gi;

function artikelnummernIn(dateiName) {
  const nummern = path.parse(dateiName).name.match(ARTIKELNUMMER) || [];
  return [...new Set(nummern.map((n) => n.toUpperCase()))];
}

// Node kann smb:// nicht lesen; eine im Dateimanager geöffnete Freigabe liegt
// aber unter gvfs: smb://host/share/rest → /run/user/<uid>/gvfs/smb-share:server=host,share=share/rest
function smbZuGvfs(quelle, uid = os.userInfo().uid) {
  const treffer = /^smb:\/\/([^/]+)\/([^/]+)(\/.*)?$/i.exec(quelle);
  if (!treffer) return quelle;
  const [, server, share, rest = ""] = treffer;
  return path.join(`/run/user/${uid}/gvfs`, `smb-share:server=${server},share=${share}`, decodeURIComponent(rest));
}

function listeDateien(ordner, relativ = "") {
  const eintraege = fs.readdirSync(path.join(ordner, relativ), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const dateien = [];
  for (const eintrag of eintraege) {
    const rel = path.join(relativ, eintrag.name);
    if (eintrag.isFile()) dateien.push(rel);
    else if (eintrag.isDirectory() && (relativ !== "" || eintrag.name.startsWith("_"))) {
      dateien.push(...listeDateien(ordner, rel));
    }
  }
  return dateien;
}

function pruefsumme(pfad) {
  return crypto.createHash("sha256").update(fs.readFileSync(pfad)).digest("hex");
}

// Gleicher Dateiname aus mehreren Ordnern: bei identischem Inhalt zählt er einmal,
// bei abweichendem Inhalt landen alle Fassungen in _manuell – wie der Import
// Duplikate behandelt, wird hier nicht still eine Fassung bevorzugt.
function sammleFotos({ quelle, ziel, dryRun = false }) {
  const kopiert = [];
  const vorhanden = [];
  const manuell = [];

  const proName = new Map();
  const uneindeutig = [];
  for (const rel of listeDateien(quelle)) {
    const name = path.basename(rel);
    const nummern = artikelnummernIn(name);
    const ergebnis = analysiereDateiname(name);
    if (nummern.length === 0 || ergebnis.status === "endung") continue;
    if (ergebnis.status !== "ok") {
      uneindeutig.push({ rel, nummern });
      continue;
    }
    const schluessel = name.toUpperCase();
    if (!proName.has(schluessel)) proName.set(schluessel, { basis: ergebnis.basis, dateien: [] });
    proName.get(schluessel).dateien.push(rel);
  }

  // "MXO100 (2).jpg" neben "MXO100.jpg" ist nur ein weiteres Foto; nach
  // _manuell kommt es erst, wenn für eine seiner Nummern kein Foto da ist.
  const abgedeckt = new Set([...proName.values()].map((g) => g.basis));
  for (const { rel, nummern } of uneindeutig) {
    if (nummern.some((n) => !abgedeckt.has(n))) manuell.push({ rel, grund: "Name nicht eindeutig" });
  }

  for (const { dateien: gruppe } of proName.values()) {
    const zielPfad = path.join(ziel, path.basename(gruppe[0]));
    const fassungen = new Map();
    if (fs.existsSync(zielPfad)) fassungen.set(pruefsumme(zielPfad), null);
    for (const rel of gruppe) {
      const summe = pruefsumme(path.join(quelle, rel));
      if (!fassungen.has(summe)) fassungen.set(summe, rel);
    }

    const neu = [...fassungen.values()].filter(Boolean);
    if (fassungen.size === 1 && neu.length === 0) {
      vorhanden.push({ rel: gruppe[0] });
    } else if (fassungen.size === 1) {
      kopiert.push({ rel: neu[0], ziel: path.basename(zielPfad) });
    } else {
      for (const rel of neu) manuell.push({ rel, grund: "gleicher Name, anderer Inhalt" });
    }
  }

  if (!dryRun) {
    fs.mkdirSync(ziel, { recursive: true });
    for (const { rel, ziel: name } of kopiert) {
      fs.copyFileSync(path.join(quelle, rel), path.join(ziel, name));
    }
    for (const { rel } of manuell) {
      const zielPfad = path.join(ziel, MANUELL, rel);
      fs.mkdirSync(path.dirname(zielPfad), { recursive: true });
      fs.copyFileSync(path.join(quelle, rel), zielPfad);
    }
  }

  return { kopiert, vorhanden, manuell };
}

function main() {
  const { values } = parseArgs({
    options: {
      quelle: { type: "string" },
      ziel: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.quelle || !values.ziel) {
    logger.error(KOMPONENTE, `--quelle oder --ziel fehlt. Aufruf: ${AUFRUF}`);
    process.exitCode = 1;
    return;
  }
  // npm run wechselt ins Paketverzeichnis; relative Pfade gelten ab dem Aufrufort.
  const aufrufOrt = process.env.INIT_CWD || process.cwd();
  const quelle = path.resolve(aufrufOrt, smbZuGvfs(values.quelle));
  const ziel = path.resolve(aufrufOrt, values.ziel);
  if (!fs.statSync(quelle, { throwIfNoEntry: false })?.isDirectory()) {
    const hinweis = values.quelle.startsWith("smb://") ? " – Freigabe erst im Dateimanager öffnen" : "";
    logger.error(KOMPONENTE, `Quellordner nicht gefunden: ${quelle}${hinweis}`);
    process.exitCode = 1;
    return;
  }

  const dryRun = values["dry-run"];
  logger.info(KOMPONENTE, `Lese ${quelle}${dryRun ? " (Dry-Run, es wird nichts kopiert)" : ""}`);
  const { kopiert, vorhanden, manuell } = sammleFotos({ quelle, ziel, dryRun });

  const zeilen = [
    `# sammle-fotos ${new Date().toISOString()} quelle=${quelle} dry-run=${dryRun}`,
    ...kopiert.map(({ rel }) => `kopiert\t${rel}`),
    ...manuell.map(({ rel, grund }) => `manuell\t${rel}\t${grund}`),
  ];
  const logPfad = path.join(dryRun ? aufrufOrt : ziel, "sammle-fotos.log");
  fs.writeFileSync(logPfad, zeilen.join("\n") + "\n");

  logger.info(KOMPONENTE, `${dryRun ? "Würde kopieren" : "Kopiert"}: ${kopiert.length}`);
  logger.info(KOMPONENTE, `Schon im Ziel: ${vorhanden.length}`);
  logger.info(KOMPONENTE, `Manuell prüfen (${MANUELL}/): ${manuell.length}`);
  logger.info(KOMPONENTE, `Liste: ${logPfad}`);
}

if (require.main === module) main();

module.exports = { sammleFotos, smbZuGvfs };
