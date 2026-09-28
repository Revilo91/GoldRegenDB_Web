// Liest die Daten aus einem PostgreSQL-Dump (pg_dump, pg_dumpall oder dem
// SQL-Export der Datensicherung) in das Format des JSON-Backups
// ({ version, tables }). Ausgeführt wird aus der Datei nichts: nur die
// `COPY ... FROM stdin`-Blöcke werden gelesen, Schema-Anweisungen, Rollen und
// Passwörter bleiben liegen. Der Import läuft danach über POST /backup/import
// mit allen Schutzmechanismen des JSON-Imports.
//
// `pg_dump --inserts` (INSERT statt COPY) wird nicht unterstützt.

const COPY_ZEILE =
  /^COPY\s+(?:(?:public|"public")\.)?("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s*\(([^)]*)\)\s+FROM\s+stdin;\s*$/;

const bezeichner = (roh) => {
  const t = roh.trim();
  return t.startsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t.toLowerCase();
};

const ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

// COPY-Textformat: \N ist NULL, Backslash leitet Escapes ein.
export function copyWert(feld) {
  if (feld === '\\N') return null;
  if (!feld.includes('\\')) return feld;
  return feld.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e) => {
    if (e[0] === 'x' && e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ESCAPES[e] ?? e;
  });
}

export function parseSqlDump(text) {
  const tables = {};
  const zeilen = text.split(/\r?\n/);
  let aktuell = null;

  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i];
    if (aktuell) {
      if (zeile === '\\.') {
        aktuell = null;
        continue;
      }
      const felder = zeile.split('\t');
      if (felder.length !== aktuell.spalten.length) {
        throw new Error(
          `Zeile ${i + 1}: ${felder.length} statt ${aktuell.spalten.length} Werte für Tabelle ${aktuell.name}`,
        );
      }
      aktuell.zeilen.push(
        Object.fromEntries(aktuell.spalten.map((s, k) => [s, copyWert(felder[k])])),
      );
      continue;
    }

    const treffer = COPY_ZEILE.exec(zeile);
    if (!treffer) continue;
    const name = bezeichner(treffer[1]);
    // pg_dumpall enthält mehrere Datenbanken; doppelte Tabellen wären geraten.
    if (tables[name]) {
      throw new Error(`Tabelle ${name} kommt mehrfach im Dump vor (mehrere Datenbanken?)`);
    }
    const spalten = treffer[2].split(',').map(bezeichner);
    tables[name] = [];
    aktuell = { name, spalten, zeilen: tables[name] };
  }

  if (aktuell) throw new Error(`COPY-Block für ${aktuell.name} endet nicht mit \\.`);
  return { version: 'sql-dump', tables };
}
