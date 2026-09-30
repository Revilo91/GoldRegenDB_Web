-- Artikelnummer nur in Großbuchstaben (Befund D4). Idempotent.
-- 'mho123' landete über SUBSTRING(...,1,1) = 'm' in keinem Hersteller-,
-- Grundmaterial- oder Produktartfilter, und als Primärschlüssel existierte
-- MHO123 neben mho123. Bestandszeilen mit Kleinbuchstaben werden nicht
-- automatisch korrigiert: eine Umbenennung des Primärschlüssels kann zwei
-- Zeilen zusammenführen müssen, das ist eine fachliche Entscheidung. Der
-- Constraint kommt dann NOT VALID und gilt nur für neue und geänderte Zeilen.

DO $$
DECLARE
    abweichend INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'Schmuckstück' AND c.conname = 'schmuck_artikelnummer_gross_chk'
    ) THEN
        SELECT count(*) INTO abweichend
        FROM "Schmuckstück" WHERE "Artikelnummer" <> UPPER("Artikelnummer");

        IF abweichend > 0 THEN
            RAISE WARNING 'Artikelnummern mit Kleinbuchstaben im Bestand (%) – Constraint wird nur für neue Zeilen gesetzt', abweichend;
            ALTER TABLE "Schmuckstück"
                ADD CONSTRAINT schmuck_artikelnummer_gross_chk
                CHECK ("Artikelnummer" = UPPER("Artikelnummer")) NOT VALID;
        ELSE
            ALTER TABLE "Schmuckstück"
                ADD CONSTRAINT schmuck_artikelnummer_gross_chk
                CHECK ("Artikelnummer" = UPPER("Artikelnummer"));
        END IF;
    END IF;
END
$$;
