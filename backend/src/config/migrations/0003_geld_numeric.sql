-- Geldspalten DOUBLE PRECISION -> numeric(10,2) (Befund B1). Idempotent.
-- 19.99 ist binär nicht exakt darstellbar; 37 Positionen à 19,99 € ergaben
-- 739.6299999999999. pg liefert numeric bewusst als String (types/db.d.ts),
-- Number() erst an der Anzeigekante.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Schmuckstück'
          AND column_name IN ('Verkaufspreis', 'Herstellungskosten')
          AND data_type <> 'numeric'
    ) THEN
        -- COALESCE fängt Altbestand ab, der vor der Frontend-Reparatur
        -- (parseFloat("") -> NaN -> null, Befund D1/D2) entstanden ist.
        UPDATE "Schmuckstück"
        SET "Verkaufspreis" = COALESCE("Verkaufspreis", 0),
            "Herstellungskosten" = COALESCE("Herstellungskosten", 0)
        WHERE "Verkaufspreis" IS NULL OR "Herstellungskosten" IS NULL;

        ALTER TABLE "Schmuckstück"
            ALTER COLUMN "Verkaufspreis"
                TYPE numeric(10,2) USING round("Verkaufspreis"::numeric, 2),
            ALTER COLUMN "Herstellungskosten"
                TYPE numeric(10,2) USING round("Herstellungskosten"::numeric, 2);
        ALTER TABLE "Schmuckstück"
            ALTER COLUMN "Verkaufspreis"      SET NOT NULL,
            ALTER COLUMN "Verkaufspreis"      SET DEFAULT 0,
            ALTER COLUMN "Herstellungskosten" SET NOT NULL,
            ALTER COLUMN "Herstellungskosten" SET DEFAULT 0;
        RAISE NOTICE 'Geldspalten auf numeric(10,2) NOT NULL umgestellt';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'Schmuckstück' AND c.conname = 'schmuck_preis_nicht_negativ'
    ) THEN
        ALTER TABLE "Schmuckstück"
            ADD CONSTRAINT schmuck_preis_nicht_negativ
            CHECK ("Verkaufspreis" >= 0 AND "Herstellungskosten" >= 0);
    END IF;
END
$$;
