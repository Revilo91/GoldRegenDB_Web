-- Statusfelder SMALLINT -> boolean (Befund B6). Idempotent: auf Datenbanken,
-- deren "Verkauft" schon boolean ist, bleibt nur die Prüfung des
-- Widerspruchs-CHECKs übrig.
--
-- Als SMALLINT waren Verkauft = 2 und NULL erlaubt, und so eine Zeile war in
-- KEINEM Filter enthalten. Die Reihenfolge der drei Schritte ist zwingend:
-- 1. Die Ausschuss_Grund-Constraint löschen: sie prüft COALESCE("Ausschuss", 0)
--    und würde beim Typwechsel neu geparst (COALESCE(boolean, integer) ist ein
--    Fehler); außerdem hätte sie das UPDATE aus Schritt 2 blockiert (Ausschuss=1
--    ohne Grund, Befund D7). 0005 legt sie in boolean-Form wieder an.
-- 2. Widersprüchliche Zeilen (Verkauft=1 UND Ausschuss=1) NOCH als SMALLINT
--    bereinigen, damit der Audit-Trigger die Korrektur im alten Wertformat
--    protokolliert. Entschieden wurde: Ausschuss ist richtig, Verkauft der
--    Fehler (Artikelnummern: db/status_widerspruch_2026-09.csv).
-- 3. Typ ändern, NOT NULL und DEFAULT setzen, dann den Widerspruchs-CHECK.

DO $$
DECLARE
    bereinigt INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Schmuckstück' AND column_name = 'Verkauft'
          AND data_type <> 'boolean'
    ) THEN
        ALTER TABLE "Schmuckstück"
            DROP CONSTRAINT IF EXISTS schmuckstueck_ausschuss_grund_required_chk;

        EXECUTE 'UPDATE "Schmuckstück" SET "Verkauft" = 0 WHERE "Verkauft" = 1 AND "Ausschuss" = 1';
        GET DIAGNOSTICS bereinigt = ROW_COUNT;
        IF bereinigt > 0 THEN
            RAISE NOTICE 'Widersprüchlicher Status bereinigt: Verkauft=0 bei % Zeilen, weil Ausschuss=1', bereinigt;
        END IF;

        ALTER TABLE "Schmuckstück"
            ALTER COLUMN "Verkauft"  DROP DEFAULT,
            ALTER COLUMN "Ausschuss" DROP DEFAULT;
        EXECUTE 'ALTER TABLE "Schmuckstück"
            ALTER COLUMN "Verkauft"  TYPE boolean USING (COALESCE("Verkauft", 0)  <> 0),
            ALTER COLUMN "Ausschuss" TYPE boolean USING (COALESCE("Ausschuss", 0) <> 0)';
        ALTER TABLE "Schmuckstück"
            ALTER COLUMN "Verkauft"  SET NOT NULL,
            ALTER COLUMN "Verkauft"  SET DEFAULT false,
            ALTER COLUMN "Ausschuss" SET NOT NULL,
            ALTER COLUMN "Ausschuss" SET DEFAULT false;
        RAISE NOTICE 'Statusfelder auf boolean NOT NULL umgestellt';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'Schmuckstück' AND c.conname = 'schmuck_status_chk'
    ) THEN
        ALTER TABLE "Schmuckstück"
            ADD CONSTRAINT schmuck_status_chk CHECK (NOT ("Verkauft" AND "Ausschuss"));
    END IF;
END
$$;
