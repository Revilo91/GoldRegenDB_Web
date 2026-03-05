-- GoldRegenDB PostgreSQL Schema
-- Migriert von MariaDB/MySQL

-- ============================================================
-- Trigger-Funktionen
-- ============================================================

CREATE OR REPLACE FUNCTION update_letzte_aenderung()
RETURNS TRIGGER AS $$
BEGIN
    NEW."Letzte_Änderung" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_schmuckstueck_changes()
RETURNS TRIGGER AS $$
DECLARE
    col_name TEXT;
    old_val TEXT;
    new_val TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Verkauft
        IF OLD."Verkauft" IS DISTINCT FROM NEW."Verkauft" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Verkauft', OLD."Verkauft"::TEXT, NEW."Verkauft"::TEXT, 'UPDATE', current_user);
        END IF;
        -- Ausgelagert
        IF OLD."Ausgelagert" IS DISTINCT FROM NEW."Ausgelagert" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausgelagert', OLD."Ausgelagert"::TEXT, NEW."Ausgelagert"::TEXT, 'UPDATE', current_user);
        END IF;
        -- Ausschuss
        IF OLD."Ausschuss" IS DISTINCT FROM NEW."Ausschuss" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss', OLD."Ausschuss"::TEXT, NEW."Ausschuss"::TEXT, 'UPDATE', current_user);
        END IF;
        -- Lieferschein_ID
        IF OLD."Lieferschein_ID" IS DISTINCT FROM NEW."Lieferschein_ID" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Lieferschein_ID', OLD."Lieferschein_ID"::TEXT, NEW."Lieferschein_ID"::TEXT, 'UPDATE', current_user);
        END IF;
        -- Rechnung_ID
        IF OLD."Rechnung_ID" IS DISTINCT FROM NEW."Rechnung_ID" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Rechnung_ID', OLD."Rechnung_ID"::TEXT, NEW."Rechnung_ID"::TEXT, 'UPDATE', current_user);
        END IF;
        -- Online
        IF OLD."Online" IS DISTINCT FROM NEW."Online" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Online', OLD."Online"::TEXT, NEW."Online"::TEXT, 'UPDATE', current_user);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Tabellen
-- ============================================================

CREATE TABLE "Kunde" (
    "ID" SERIAL,
    "Name" VARCHAR(100) NOT NULL,
    "Strasse" TEXT NOT NULL,
    "Hausnummer" INTEGER NOT NULL,
    "Ort" TEXT NOT NULL,
    "PLZ" INTEGER NOT NULL,
    "Email" TEXT DEFAULT NULL,
    "Telefonnummer" TEXT DEFAULT NULL,
    "Provision" INTEGER NOT NULL DEFAULT 0,
    "Aktiv" BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY ("Name"),
    UNIQUE ("ID")
);

CREATE TABLE "Lieferschein" (
    "ID" SERIAL,
    "Nummer" VARCHAR(20) NOT NULL,
    "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Nummer"),
    UNIQUE ("ID"),
    CONSTRAINT "Lieferschein_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);

CREATE TABLE "Rechnung" (
    "ID" SERIAL,
    "Nummer" VARCHAR(20) NOT NULL,
    "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Nummer"),
    CONSTRAINT "Rechnung_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);

CREATE INDEX idx_rechnung_id ON "Rechnung" ("ID");
CREATE INDEX idx_rechnung_kundennummer ON "Rechnung" ("Kundennummer");

CREATE TABLE "Schmuckstück" (
    "Artikelnummer" VARCHAR(20) NOT NULL,
    "Name" TEXT DEFAULT NULL,
    "Art" TEXT DEFAULT NULL,
    "Form" TEXT DEFAULT NULL,
    "Länge" DOUBLE PRECISION DEFAULT 0,
    "Fassung" TEXT DEFAULT NULL,
    "Farbe" TEXT DEFAULT NULL,
    "Inhalt_Material" TEXT DEFAULT NULL,
    "Inhalt_Farbe" TEXT DEFAULT NULL,
    "Inhalt_Farbakzent" TEXT DEFAULT NULL,
    "Inhalt_Zusatzmaterial" TEXT DEFAULT NULL,
    "Anhänger_Fassung" TEXT DEFAULT NULL,
    "Anhänger_Form" TEXT DEFAULT NULL,
    "Anhänger_Farbe" TEXT DEFAULT NULL,
    "Anhänger_Grösse" DOUBLE PRECISION DEFAULT 0,
    "Anhänger_Inhalt_Material" TEXT DEFAULT NULL,
    "Anhänger_Inhalt_Farbe" TEXT DEFAULT NULL,
    "Anhänger_Inhalt_Farbakzente" TEXT DEFAULT NULL,
    "Anhänger_Inhalt_Zusatzmaterial" TEXT DEFAULT NULL,
    "Material" TEXT DEFAULT NULL,
    "Grösse" DOUBLE PRECISION DEFAULT 0,
    "Anhänger" TEXT DEFAULT NULL,
    "Zwischenstück" TEXT DEFAULT NULL,
    "Herstellungskosten" DOUBLE PRECISION DEFAULT 0,
    "Verkaufspreis" DOUBLE PRECISION DEFAULT 0,
    "Online" SMALLINT DEFAULT 0,
    "Ausgelagert" INTEGER DEFAULT 0,
    "Verkauft" SMALLINT DEFAULT 0,
    "Ausschuss" SMALLINT DEFAULT 0,
    "Lieferschein_ID" INTEGER DEFAULT 0,
    "Rechnung_ID" INTEGER DEFAULT 0,
    "Erstelldatum" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Letzte_Änderung" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Artikelnummer")
);

CREATE INDEX idx_schmuck_ausgelagert ON "Schmuckstück" ("Ausgelagert");
CREATE INDEX idx_schmuck_lieferschein ON "Schmuckstück" ("Lieferschein_ID");
CREATE INDEX idx_schmuck_rechnung ON "Schmuckstück" ("Rechnung_ID");

CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(255) NOT NULL,
    artikelnummer_id VARCHAR(20) DEFAULT NULL,
    column_name VARCHAR(255) DEFAULT NULL,
    old_value TEXT DEFAULT NULL,
    new_value TEXT DEFAULT NULL,
    action_type VARCHAR(10) NOT NULL,
    changed_by VARCHAR(255) DEFAULT NULL,
    change_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- User Management
-- ============================================================

-- Benutzerverwaltung
-- ============================================================

CREATE TABLE IF NOT EXISTS app_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT DEFAULT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT NULL,
    CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'user'))
);

-- Default admin user (password: admin – must be changed after first login)
INSERT INTO app_users (username, password_hash, email, role, active)
VALUES ('admin', '$2b$10$PEPpBG.7g5QFmj8p0XXU6u2/IfVwLCXPlvRnnDPCqSXuTX5uFt/zq', 'admin@goldregen.local', 'admin', TRUE)
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- Trigger
-- ============================================================

CREATE TRIGGER trg_update_letzte_aenderung
    BEFORE UPDATE ON "Schmuckstück"
    FOR EACH ROW
    EXECUTE FUNCTION update_letzte_aenderung();

CREATE TRIGGER trg_audit_schmuckstueck
    AFTER UPDATE ON "Schmuckstück"
    FOR EACH ROW
    EXECUTE FUNCTION audit_schmuckstueck_changes();
