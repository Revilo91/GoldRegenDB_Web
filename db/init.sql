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
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Verkauft', OLD."Verkauft"::TEXT, NEW."Verkauft"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        -- Ausgelagert
        IF OLD."Ausgelagert" IS DISTINCT FROM NEW."Ausgelagert" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausgelagert', OLD."Ausgelagert"::TEXT, NEW."Ausgelagert"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        -- Ausschuss
        IF OLD."Ausschuss" IS DISTINCT FROM NEW."Ausschuss" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss', OLD."Ausschuss"::TEXT, NEW."Ausschuss"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        -- Lieferschein_ID
        IF OLD."Lieferschein_ID" IS DISTINCT FROM NEW."Lieferschein_ID" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Lieferschein_ID', OLD."Lieferschein_ID"::TEXT, NEW."Lieferschein_ID"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        -- Rechnung_ID
        IF OLD."Rechnung_ID" IS DISTINCT FROM NEW."Rechnung_ID" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Rechnung_ID', OLD."Rechnung_ID"::TEXT, NEW."Rechnung_ID"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
            -- Ausschuss_Grund
        IF OLD."Ausschuss_Grund" IS DISTINCT FROM NEW."Ausschuss_Grund" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss_Grund', OLD."Ausschuss_Grund", NEW."Ausschuss_Grund", 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
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
    status VARCHAR(20) NOT NULL DEFAULT 'final',
    PRIMARY KEY ("Nummer"),
    UNIQUE ("ID"),
    CONSTRAINT "Lieferschein_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);

CREATE TABLE "Rechnung" (
    "ID" SERIAL,
    "Nummer" VARCHAR(20) NOT NULL,
    "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'final',
    PRIMARY KEY ("Nummer"),
    CONSTRAINT "Rechnung_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);

CREATE INDEX idx_rechnung_id ON "Rechnung" ("ID");
CREATE INDEX idx_rechnung_kundennummer ON "Rechnung" ("Kundennummer");

CREATE TABLE "Schmuckstück" (
    "Artikelnummer" VARCHAR(20) NOT NULL,
    "Name" TEXT DEFAULT NULL,
    "Foto" TEXT DEFAULT NULL,
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
    "Ausgelagert" INTEGER DEFAULT 0,
    "Verkauft" SMALLINT DEFAULT 0,
    "Ausschuss" SMALLINT DEFAULT 0,
    "Ausschuss_Grund" TEXT DEFAULT NULL,
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
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT NULL,
    CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'bearbeiter', 'user'))
);

INSERT INTO app_users (username, password_hash, email, role, active, must_change_password)
VALUES ('admin', '$2b$10$oxmaxGKMc6AHPtrr1G3QbOnaXJziFbSdvC5HlU6k/2lBnVyqqOX5W', 'admin@goldregen.local', 'admin', TRUE, TRUE)
ON CONFLICT (username) DO NOTHING;


-- ============================================================
-- Lager-Inventur-Entwürfe
-- ============================================================
CREATE TABLE IF NOT EXISTS lagerinventur (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES app_users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'entwurf', -- entwurf | abgeschlossen
    data JSONB NOT NULL, -- Artikelnummern und gezählte Mengen
    kommentar TEXT
);

CREATE INDEX IF NOT EXISTS idx_lagerinventur_user_status ON lagerinventur(user_id, status);

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

-- ============================================================
-- Bestellübersicht (DSGVO-konform)
-- Trennung Stammdaten (bestellung_kunde, verschlüsselt, anonymisierbar)
-- von Transaktionsdaten (bestellung), siehe backend/src/utils/encryptionService.js
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'versandart_typ') THEN
        CREATE TYPE versandart_typ AS ENUM ('lieferung', 'abholung');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bestellstatus_typ') THEN
        CREATE TYPE bestellstatus_typ AS ENUM ('offen', 'in_bearbeitung', 'abgeschlossen', 'storniert');
    END IF;
END
$$;

CREATE TABLE bestellung_kunde (
    id SERIAL PRIMARY KEY,
    kunde_pseudonym VARCHAR(20) NOT NULL UNIQUE,
    -- Alle personenbezogenen Felder AES-256-GCM-verschlüsselt (Applikationsebene).
    -- NULL = nicht erfasst ODER bereits anonymisiert.
    -- Nicht NOT NULL: die Anonymisierungsfunktion muss den Wert auf NULL setzen können.
    -- Am Erfassungspunkt wird ein Name applikationsseitig (validateDatenminimierung) erzwungen.
    name_enc          BYTEA DEFAULT NULL,
    email_enc         BYTEA DEFAULT NULL,
    telefonnummer_enc BYTEA DEFAULT NULL,
    strasse_enc       BYTEA DEFAULT NULL,
    hausnummer_enc    BYTEA DEFAULT NULL,
    plz_enc           BYTEA DEFAULT NULL,
    ort_enc           BYTEA DEFAULT NULL,
    anonymisiert      BOOLEAN NOT NULL DEFAULT FALSE,
    anonymisiert_am   TIMESTAMP DEFAULT NULL,
    erstellt_am       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bestellung (
    id SERIAL PRIMARY KEY,
    bestellnummer   VARCHAR(20) NOT NULL UNIQUE,
    kunde_id        INTEGER NOT NULL REFERENCES bestellung_kunde(id),
    versandart      versandart_typ NOT NULL,
    erfassungsdatum TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    wunschdatum     DATE DEFAULT NULL,
    beschreibung    TEXT NOT NULL,
    status          bestellstatus_typ NOT NULL DEFAULT 'offen',
    rechnung_nummer VARCHAR(20) DEFAULT NULL REFERENCES "Rechnung"("Nummer"),
    erstellt_von    VARCHAR(100) NOT NULL,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bestellung_wunschdatum_check
        CHECK (wunschdatum IS NULL OR wunschdatum >= erfassungsdatum::date)
);

CREATE INDEX idx_bestellung_kunde ON bestellung(kunde_id);
CREATE INDEX idx_bestellung_status ON bestellung(status);
CREATE INDEX idx_bestellung_erfassungsdatum ON bestellung(erfassungsdatum);

CREATE TABLE bestellung_consent (
    id SERIAL PRIMARY KEY,
    kunde_id            INTEGER NOT NULL REFERENCES bestellung_kunde(id),
    consent_typ         VARCHAR(50) NOT NULL DEFAULT 'datenverarbeitung_bestellung',
    consent_erteilt     BOOLEAN NOT NULL,
    consent_zeitpunkt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    datenschutz_version VARCHAR(20) NOT NULL,
    ip_hash             TEXT DEFAULT NULL
);

CREATE INDEX idx_bestellung_consent_kunde ON bestellung_consent(kunde_id);

-- Datenminimierung: "lieferung" erfordert Adresse + Telefon, "abholung" nicht.
-- Greift nur bei nicht-anonymisierten Kunden (sonst würde die Anonymisierung
-- spätere Status-Updates der Bestellung blockieren).
CREATE OR REPLACE FUNCTION check_datenminimierung_versandart()
RETURNS TRIGGER AS $$
DECLARE
    hat_adresse BOOLEAN;
    hat_telefon BOOLEAN;
    ist_anonymisiert BOOLEAN;
BEGIN
    IF NEW.versandart = 'lieferung' THEN
        SELECT (strasse_enc IS NOT NULL AND hausnummer_enc IS NOT NULL
                AND plz_enc IS NOT NULL AND ort_enc IS NOT NULL),
               (telefonnummer_enc IS NOT NULL),
               anonymisiert
          INTO hat_adresse, hat_telefon, ist_anonymisiert
          FROM bestellung_kunde WHERE id = NEW.kunde_id;

        IF NOT ist_anonymisiert THEN
            IF NOT hat_adresse THEN
                RAISE EXCEPTION 'Versandart "lieferung" erfordert eine vollständige Adresse (Art. 5 Abs. 1 lit. c DSGVO)';
            END IF;
            IF NOT hat_telefon THEN
                RAISE EXCEPTION 'Versandart "lieferung" erfordert eine Telefonnummer für die Spedition';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- erfassungsdatum unveränderlich, aktualisiert_am pflegen
CREATE OR REPLACE FUNCTION update_bestellung_aktualisiert()
RETURNS TRIGGER AS $$
BEGIN
    NEW.erfassungsdatum = OLD.erfassungsdatum;
    NEW.aktualisiert_am = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recht auf Vergessenwerden (Art. 17 DSGVO): PII in bestellung_kunde löschen,
-- bestellung (Transaktionsdaten) bleibt für Statistik/Buchhaltung erhalten.
CREATE OR REPLACE FUNCTION anonymisiere_bestellung_kunde(p_kunde_id INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE bestellung_kunde
    SET name_enc = NULL,
        email_enc = NULL,
        telefonnummer_enc = NULL,
        strasse_enc = NULL,
        hausnummer_enc = NULL,
        plz_enc = NULL,
        ort_enc = NULL,
        anonymisiert = TRUE,
        anonymisiert_am = CURRENT_TIMESTAMP
    WHERE id = p_kunde_id AND anonymisiert = FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bestellung_datenminimierung
    BEFORE INSERT OR UPDATE ON bestellung
    FOR EACH ROW
    EXECUTE FUNCTION check_datenminimierung_versandart();

CREATE TRIGGER trg_bestellung_aktualisiert
    BEFORE UPDATE ON bestellung
    FOR EACH ROW
    EXECUTE FUNCTION update_bestellung_aktualisiert();
