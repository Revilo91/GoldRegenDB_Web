-- Rechnungs-Snapshot (Issue #283, Schritt 2): Positionen und Summen einer
-- Rechnung werden beim Anlegen/Ändern festgeschrieben, damit spätere Preis-
-- oder Rabattänderungen eine finale Rechnung nicht mehr verändern. Idempotent.
-- NULL in snapshot_am = noch nicht eingefroren.

CREATE TABLE IF NOT EXISTS "Rechnung_Position" (
    id SERIAL PRIMARY KEY,
    rechnung_id INTEGER NOT NULL REFERENCES "Rechnung" ("ID") ON DELETE CASCADE,
    artikelnummer_id VARCHAR(20) NOT NULL,
    basis_artikelnummer VARCHAR(20) NOT NULL,
    einzelpreis NUMERIC(10,2) NOT NULL,
    positionsrabatt NUMERIC(5,2) NOT NULL DEFAULT 0,
    UNIQUE (rechnung_id, artikelnummer_id)
);
CREATE INDEX IF NOT EXISTS idx_rechnung_position_rechnung ON "Rechnung_Position" (rechnung_id);

-- rabatt_gesamt (Prozent), rabatt_positionen und versandkosten (Eingabe) gibt es
-- schon; hier kommen nur die berechneten Beträge dazu.
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS summe_brutto NUMERIC(10,2);
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS rabatt_gesamt_betrag NUMERIC(10,2);
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS provision_prozent NUMERIC(10,2);
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS provision_betrag NUMERIC(10,2);
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS versand_betrag NUMERIC(10,2);
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS summe_ueberweisung NUMERIC(10,2);
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS snapshot_am TIMESTAMPTZ;

-- Backfill der finalen Rechnungen ohne Snapshot. Die Rechenschritte spiegeln
-- belegSummen() in utils/rabatt.js (pro Stück auf Cent runden, dann summieren,
-- jede Stufe aus der gerundeten Vorstufe); rechnungSnapshot.integration.test.js prüft das.
WITH offen AS (
    SELECT r."ID" AS rechnung_id
    FROM "Rechnung" r
    WHERE r.status = 'final' AND r.snapshot_am IS NULL
),
positionen AS (  -- datenänderndes CTE läuft auch unreferenziert vollständig
    INSERT INTO "Rechnung_Position"
        (rechnung_id, artikelnummer_id, basis_artikelnummer, einzelpreis, positionsrabatt)
    SELECT r."ID", s."Artikelnummer", split_part(s."Artikelnummer", '_', 1), s."Verkaufspreis",
           COALESCE(NULLIF(r.rabatt_positionen ->> split_part(s."Artikelnummer", '_', 1), '')::numeric, 0)
    FROM offen o
    JOIN "Rechnung" r ON r."ID" = o.rechnung_id
    JOIN "Schmuckstück" s ON s."Rechnung_ID" = r."ID"
    ON CONFLICT (rechnung_id, artikelnummer_id) DO NOTHING
    RETURNING 1
),
wert AS (
    SELECT o.rechnung_id,
           COALESCE(SUM(round((s."Verkaufspreis" * (1 - COALESCE(
               NULLIF(r.rabatt_positionen ->> split_part(s."Artikelnummer", '_', 1), '')::numeric,
               0) / 100))::numeric, 2)), 0) AS summe
    FROM offen o
    JOIN "Rechnung" r ON r."ID" = o.rechnung_id
    LEFT JOIN "Schmuckstück" s ON s."Rechnung_ID" = r."ID"
    GROUP BY o.rechnung_id
),
schritte AS (
    SELECT w.rechnung_id,
           round(w.summe, 2) AS brutto,
           round(round(w.summe, 2) * COALESCE(r.rabatt_gesamt, 0)::numeric / 100, 2) AS rabatt_betrag,
           COALESCE(k."Provision", 0)::numeric AS provision,
           COALESCE(r.versandkosten, 0)::numeric AS versand
    FROM wert w
    JOIN "Rechnung" r ON r."ID" = w.rechnung_id
    LEFT JOIN "Kunde" k ON k."ID" = r."Kundennummer"
),
mit_provision AS (
    SELECT schritte.*,
           round((brutto - rabatt_betrag) * provision / 100, 2) AS provision_betrag
    FROM schritte
)
UPDATE "Rechnung" r
SET summe_brutto = m.brutto,
    rabatt_gesamt_betrag = m.rabatt_betrag,
    provision_prozent = m.provision,
    provision_betrag = m.provision_betrag,
    versand_betrag = m.versand,
    summe_ueberweisung = (m.brutto - m.rabatt_betrag) - m.provision_betrag + m.versand,
    snapshot_am = now()
FROM mit_provision m
WHERE r."ID" = m.rechnung_id;
