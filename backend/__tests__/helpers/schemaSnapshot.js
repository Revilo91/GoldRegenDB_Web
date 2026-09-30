'use strict';

// Vergleichbarer Schemastand einer Datenbank (Schema public): Spalten,
// Constraints, Indizes, Trigger, eigene Funktionen, Enum-Typen, Extensions.
// Genutzt vom Vergleich "Migrationen" vs. "init.sql + Migrationen"
// (migrations.integration.test.js). Die Spaltenreihenfolge ist optional:
// Bestandsdatenbanken haben nachträglich angehängte Spalten am Tabellenende.
async function schemaSnapshot(query, { mitSpaltenreihenfolge = false } = {}) {
  const rows = async (sql) => (await query(sql)).rows;

  const spalten = await rows(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name,
           character_maximum_length, numeric_precision, numeric_scale,
           is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  if (!mitSpaltenreihenfolge) {
    for (const s of spalten) delete s.ordinal_position;
  }

  const constraints = await rows(`
    SELECT c.conrelid::regclass::text AS tabelle, c.conname, c.contype,
           pg_get_constraintdef(c.oid) AS definition, c.convalidated
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conrelid <> 0
    ORDER BY 1, 2
  `);

  const indizes = await rows(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);

  const trigger = await rows(`
    SELECT t.tgrelid::regclass::text AS tabelle, t.tgname, t.tgenabled,
           pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY 1, 2
  `);

  // Ohne Extension-Funktionen (pgcrypto): die gehören nicht zum eigenen Schema.
  const funktionen = await rows(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumente,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
    ORDER BY 1, 2
  `);

  const enums = await rows(`
    SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS werte
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `);

  const extensions = await rows('SELECT extname FROM pg_extension ORDER BY extname');

  const migrationen = await rows(`
    SELECT version, name FROM schema_migrations ORDER BY version
  `);

  return { spalten, constraints, indizes, trigger, funktionen, enums, extensions, migrationen };
}

module.exports = { schemaSnapshot };
