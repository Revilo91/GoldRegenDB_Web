import { copyWert, parseSqlDump } from '../utils/sqlDump';

const dump = [
  '\\connect goldregendb',
  "CREATE ROLE x PASSWORD 'geheim';",
  'COPY public."Kunde" ("ID", "Name", "Email") FROM stdin;',
  '1\tMüller\\tGmbH\t\\N',
  '2\tZeile\\nzwei\t',
  '\\.',
  'COPY public.app_users (id, username) FROM stdin;',
  '\\.',
  'COPY "Rechnung" ("ID") FROM stdin;',
  '7',
  '\\.',
].join('\n');

it('liest COPY-Blöcke in das Backup-Format', () => {
  const { version, tables } = parseSqlDump(dump);
  expect(version).toBe('sql-dump');
  expect(Object.keys(tables)).toEqual(['Kunde', 'app_users', 'Rechnung']);
  expect(tables.Kunde).toEqual([
    { ID: '1', Name: 'Müller\tGmbH', Email: null },
    { ID: '2', Name: 'Zeile\nzwei', Email: '' },
  ]);
  expect(tables.app_users).toEqual([]);
  expect(tables.Rechnung).toEqual([{ ID: '7' }]);
});

it('dekodiert COPY-Escapes', () => {
  expect(copyWert('\\N')).toBeNull();
  expect(copyWert('a\\\\b')).toBe('a\\b');
  expect(copyWert('\\\\x0a1b')).toBe('\\x0a1b');
  expect(copyWert('\\101\\x42')).toBe('AB');
});

it('meldet Zeilen mit falscher Spaltenzahl', () => {
  expect(() => parseSqlDump('COPY "T" (a, b) FROM stdin;\n1\n\\.')).toThrow(/1 statt 2/);
});

it('meldet einen nicht abgeschlossenen Block', () => {
  expect(() => parseSqlDump('COPY "T" (a) FROM stdin;\n1')).toThrow(/endet nicht/);
});

it('lehnt doppelte Tabellen aus mehreren Datenbanken ab', () => {
  const block = 'COPY "T" (a) FROM stdin;\n1\n\\.\n';
  expect(() => parseSqlDump(block + block)).toThrow(/mehrfach/);
});
