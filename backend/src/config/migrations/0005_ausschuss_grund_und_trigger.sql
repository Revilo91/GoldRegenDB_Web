-- Ausschuss_Grund-Constraint und Trigger auf "Schmuckstück". Idempotent.
-- Bewusst nach 0002: die Statusumstellung löscht die Constraint vor dem
-- Typwechsel, hier wird sie in boolean-Form angelegt. Die Trigger standen im
-- früheren Startup-Code ebenfalls am Ende der Kette.

-- NOT VALID: der Bestand hat Ausschuss-Stücke ohne Grund (Befund D7); geprüft
-- werden neue und geänderte Zeilen.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'Schmuckstück'
          AND c.conname = 'schmuckstueck_ausschuss_grund_required_chk'
    ) THEN
        ALTER TABLE "Schmuckstück"
            ADD CONSTRAINT schmuckstueck_ausschuss_grund_required_chk
            CHECK (
                "Ausschuss" IS NOT TRUE
                OR LENGTH(BTRIM(COALESCE("Ausschuss_Grund", ''))) > 0
            ) NOT VALID;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_letzte_aenderung'
    ) THEN
        CREATE TRIGGER trg_update_letzte_aenderung
            BEFORE UPDATE ON "Schmuckstück"
            FOR EACH ROW
            EXECUTE FUNCTION update_letzte_aenderung();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_schmuckstueck'
    ) THEN
        CREATE TRIGGER trg_audit_schmuckstueck
            AFTER UPDATE ON "Schmuckstück"
            FOR EACH ROW
            EXECUTE FUNCTION audit_schmuckstueck_changes();
    END IF;
END
$$;
