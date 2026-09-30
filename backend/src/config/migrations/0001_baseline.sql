-- Baseline (Issue #257): Schema-Stand der früheren ensure…-Funktionen aus
-- backend/src/config/db.js, in derselben Reihenfolge. Idempotent formuliert,
-- weil sie auf drei Ausgangslagen laufen muss: leere Datenbank, frisch per
-- db/init.sql angelegte Datenbank und Bestandsdatenbanken beliebig alter Stände
-- (ohne schema_migrations). Nie nachträglich ändern – neue Schemaänderungen
-- kommen als neue, höher nummerierte Datei.

-- ---- Trigger-Funktionen ----

CREATE OR REPLACE FUNCTION update_letzte_aenderung()
RETURNS TRIGGER AS $$
BEGIN
    NEW."Letzte_Änderung" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_schmuckstueck_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD."Verkauft" IS DISTINCT FROM NEW."Verkauft" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Verkauft', OLD."Verkauft"::TEXT, NEW."Verkauft"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        IF OLD."Ausgelagert" IS DISTINCT FROM NEW."Ausgelagert" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausgelagert', OLD."Ausgelagert"::TEXT, NEW."Ausgelagert"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        IF OLD."Ausschuss" IS DISTINCT FROM NEW."Ausschuss" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss', OLD."Ausschuss"::TEXT, NEW."Ausschuss"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        IF OLD."Lieferschein_ID" IS DISTINCT FROM NEW."Lieferschein_ID" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Lieferschein_ID', OLD."Lieferschein_ID"::TEXT, NEW."Lieferschein_ID"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        IF OLD."Rechnung_ID" IS DISTINCT FROM NEW."Rechnung_ID" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Rechnung_ID', OLD."Rechnung_ID"::TEXT, NEW."Rechnung_ID"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
        IF OLD."Ausschuss_Grund" IS DISTINCT FROM NEW."Ausschuss_Grund" THEN
            INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
            VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss_Grund', OLD."Ausschuss_Grund", NEW."Ausschuss_Grund", 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---- Tabelle: Kunde ----

CREATE TABLE IF NOT EXISTS "Kunde" (
    "ID" SERIAL,
    "Name" VARCHAR(100) NOT NULL,
    "Strasse" TEXT NOT NULL,
    "Hausnummer" TEXT NOT NULL DEFAULT '',
    "Ort" TEXT NOT NULL,
    "PLZ" INTEGER NOT NULL,
    "Email" TEXT DEFAULT NULL,
    "Telefonnummer" TEXT DEFAULT NULL,
    "Provision" INTEGER NOT NULL DEFAULT 0,
    "Aktiv" BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY ("Name"),
    UNIQUE ("ID")
);

-- Befund B6: ein neu angelegter Kunde war standardmäßig inaktiv. Ein DEFAULT
-- wirkt nur auf neue Zeilen, Bestandsdaten bleiben unberührt.
ALTER TABLE "Kunde" ALTER COLUMN "Aktiv" SET DEFAULT TRUE;

-- E-Rechnung (EN 16931): Ländercode BT-55, USt-IdNr. BT-48, Leitweg-ID/Käuferreferenz BT-10
ALTER TABLE "Kunde" ADD COLUMN IF NOT EXISTS "Land" CHAR(2) NOT NULL DEFAULT 'DE';
ALTER TABLE "Kunde" ADD COLUMN IF NOT EXISTS "UStIdNr" VARCHAR(20) DEFAULT NULL;
ALTER TABLE "Kunde" ADD COLUMN IF NOT EXISTS "Leitweg_ID" VARCHAR(50) DEFAULT NULL;

-- Direktverkauf: die Erstbelegung läuft nur beim Anlegen der Spalte, danach
-- gilt das Häkchen in der Kundenverwaltung.
DO $$
DECLARE
    gesetzt INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Kunde' AND column_name = 'Direktverkauf'
    ) THEN
        ALTER TABLE "Kunde" ADD COLUMN "Direktverkauf" BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE "Kunde" SET "Direktverkauf" = TRUE
        WHERE "Name" IN ('Online', 'Messe', 'Sonderanfertigung', 'Saskia Stempfhuber');
        GET DIAGNOSTICS gesetzt = ROW_COUNT;
        RAISE NOTICE '"Kunde"."Direktverkauf" angelegt, % Kunden gesetzt', gesetzt;
    END IF;
END
$$;

-- Hausnummer INTEGER -> TEXT (Issue #211): "12a" war nicht speicherbar. 0 war
-- der Platzhalter für "keine Hausnummer" (Messe, Online) und wird zum Leerstring.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Kunde' AND column_name = 'Hausnummer'
          AND data_type <> 'text'
    ) THEN
        ALTER TABLE "Kunde"
          ALTER COLUMN "Hausnummer" TYPE TEXT
            USING (CASE WHEN "Hausnummer" = 0 THEN '' ELSE "Hausnummer"::text END),
          ALTER COLUMN "Hausnummer" SET DEFAULT '';
        RAISE NOTICE '"Kunde"."Hausnummer" auf TEXT umgestellt';
    END IF;
END
$$;

-- ---- Tabelle: Lieferschein ----

CREATE TABLE IF NOT EXISTS "Lieferschein" (
    "ID" SERIAL,
    "Nummer" VARCHAR(20) NOT NULL,
    "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Nummer"),
    UNIQUE ("ID"),
    CONSTRAINT "Lieferschein_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Lieferschein' AND column_name = 'status'
    ) THEN
        ALTER TABLE "Lieferschein" ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'final';
    END IF;
END
$$;

-- Befund B11: Fremdschlüsselprüfung beim DELETE auf "Kunde" und die
-- Default-Sortierung der Dokumentlisten ("Datum" DESC).
CREATE INDEX IF NOT EXISTS idx_lieferschein_kundennummer ON "Lieferschein" ("Kundennummer");
CREATE INDEX IF NOT EXISTS idx_lieferschein_datum ON "Lieferschein" ("Datum" DESC);

-- ---- Tabelle: Rechnung ----

CREATE TABLE IF NOT EXISTS "Rechnung" (
    "ID" SERIAL,
    "Nummer" VARCHAR(20) NOT NULL,
    "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Nummer"),
    CONSTRAINT "Rechnung_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);
CREATE INDEX IF NOT EXISTS idx_rechnung_kundennummer ON "Rechnung" ("Kundennummer");
CREATE INDEX IF NOT EXISTS idx_rechnung_datum ON "Rechnung" ("Datum" DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Rechnung' AND column_name = 'status'
    ) THEN
        ALTER TABLE "Rechnung" ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'final';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Rechnung' AND column_name = 'rabatt_gesamt'
    ) THEN
        ALTER TABLE "Rechnung" ADD COLUMN rabatt_gesamt NUMERIC(5,2) NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Rechnung' AND column_name = 'rabatt_positionen'
    ) THEN
        ALTER TABLE "Rechnung" ADD COLUMN rabatt_positionen JSONB NOT NULL DEFAULT '{}';
    END IF;
END
$$;

-- Einmalkunde (Onlineshop): Anschrift nur auf der Rechnung, nicht in "Kunde"
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS empfaenger JSONB DEFAULT NULL;
ALTER TABLE "Rechnung" ADD COLUMN IF NOT EXISTS versandkosten NUMERIC(10,2) DEFAULT NULL;

-- Befund B4: UNIQUE auf "ID" nachziehen. Ohne Eindeutigkeit mischt jeder JOIN
-- über "Schmuckstück"."Rechnung_ID" die Positionen zweier Rechnungen. Der
-- UNIQUE-Constraint bringt seinen eigenen Index mit, idx_rechnung_id entfällt.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'Rechnung'
          AND c.conname = 'rechnung_id_key'
    ) THEN
        ALTER TABLE "Rechnung" ADD CONSTRAINT rechnung_id_key UNIQUE ("ID");
        DROP INDEX IF EXISTS idx_rechnung_id;
    END IF;
END
$$;

-- ---- Tabelle: Schmuckstück ----

CREATE TABLE IF NOT EXISTS "Schmuckstück" (
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
    "Herstellungskosten" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "Verkaufspreis" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "Ausgelagert" INTEGER DEFAULT 0,
    "Verkauft" BOOLEAN NOT NULL DEFAULT FALSE,
    "Ausschuss" BOOLEAN NOT NULL DEFAULT FALSE,
    "Ausschuss_Grund" TEXT DEFAULT NULL,
    "Lieferschein_ID" INTEGER DEFAULT 0,
    "Rechnung_ID" INTEGER DEFAULT 0,
    "Erstelldatum" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Letzte_Änderung" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Artikelnummer")
);
CREATE INDEX IF NOT EXISTS idx_schmuck_ausgelagert ON "Schmuckstück" ("Ausgelagert");
CREATE INDEX IF NOT EXISTS idx_schmuck_lieferschein ON "Schmuckstück" ("Lieferschein_ID");
CREATE INDEX IF NOT EXISTS idx_schmuck_rechnung ON "Schmuckstück" ("Rechnung_ID");
-- Sortierreihenfolge der Listenansicht; ohne diesen Index sortiert Postgres
-- bei jedem Seitenwechsel die komplette Tabelle neu.
CREATE INDEX IF NOT EXISTS idx_schmuck_artikelnummer_sort
    ON "Schmuckstück" (length("Artikelnummer"), "Artikelnummer");
-- Statusfilter (verfügbar / verkauft / Ausschuss) aus dem whereClauseBuilder
CREATE INDEX IF NOT EXISTS idx_schmuck_status
    ON "Schmuckstück" ("Verkauft", "Ausschuss", "Ausgelagert");

-- ---- Tabelle: audit_log ----

CREATE TABLE IF NOT EXISTS audit_log (
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
-- Befund B11: die Tabelle wächst unbegrenzt und wird durchweg nach
-- Zeitstempel abgefragt (Dashboard, Audit-Log-Seite, Artikelhistorie).
CREATE INDEX IF NOT EXISTS idx_audit_ts
    ON audit_log (change_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_artikel
    ON audit_log (artikelnummer_id, change_timestamp DESC);

-- ---- Tamper-Schutz audit_log (Issue #139): Hash-Kette + Immutabilität ----
-- Reihenfolge ist zwingend: Spalten/Funktionen anlegen → Alt-Einträge per
-- backfill_audit_chain() nachverketten → erst danach trg_audit_log_immutable
-- anlegen. Vorhandene Hashes werden nie neu berechnet, nachverkettet werden
-- nur Zeilen mit hash IS NULL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS previous_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS hash CHAR(64);

CREATE OR REPLACE FUNCTION audit_log_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash CHAR(64);
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
    SELECT hash INTO prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
    NEW.previous_hash := prev_hash;
    NEW.hash := encode(digest(concat_ws('|',
        NEW.id::text, NEW.table_name, COALESCE(NEW.artikelnummer_id, ''),
        COALESCE(NEW.column_name, ''), COALESCE(NEW.old_value, ''),
        COALESCE(NEW.new_value, ''), NEW.action_type, COALESCE(NEW.changed_by, ''),
        NEW.change_timestamp::text, COALESCE(NEW.previous_hash, '')
    ), 'sha256'), 'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_prevent_tamper()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log ist unveränderlich (Tamper-Schutz, Issue #139): % ist nicht erlaubt', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION backfill_audit_chain()
RETURNS VOID AS $$
DECLARE
    rec RECORD;
    prev_hash CHAR(64);
    new_hash CHAR(64);
BEGIN
    SELECT hash INTO prev_hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1;
    FOR rec IN SELECT * FROM audit_log WHERE hash IS NULL ORDER BY id LOOP
        new_hash := encode(digest(concat_ws('|',
            rec.id::text, rec.table_name, COALESCE(rec.artikelnummer_id, ''),
            COALESCE(rec.column_name, ''), COALESCE(rec.old_value, ''),
            COALESCE(rec.new_value, ''), rec.action_type, COALESCE(rec.changed_by, ''),
            rec.change_timestamp::text, COALESCE(prev_hash, '')
        ), 'sha256'), 'hex');
        UPDATE audit_log SET previous_hash = prev_hash, hash = new_hash WHERE id = rec.id;
        prev_hash := new_hash;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE(id INTEGER, problem TEXT) AS $$
BEGIN
    RETURN QUERY
    WITH chain AS (
        SELECT a.id, a.hash, a.previous_hash,
               lag(a.hash) OVER (ORDER BY a.id) AS expected_previous_hash,
               encode(digest(concat_ws('|',
                   a.id::text, a.table_name, COALESCE(a.artikelnummer_id, ''),
                   COALESCE(a.column_name, ''), COALESCE(a.old_value, ''),
                   COALESCE(a.new_value, ''), a.action_type, COALESCE(a.changed_by, ''),
                   a.change_timestamp::text, COALESCE(a.previous_hash, '')
               ), 'sha256'), 'hex') AS recomputed_hash
        FROM audit_log a
    )
    SELECT chain.id,
           CASE
               WHEN chain.hash IS DISTINCT FROM chain.recomputed_hash THEN 'hash_mismatch'
               ELSE 'chain_broken'
           END AS problem
    FROM chain
    WHERE chain.hash IS DISTINCT FROM chain.recomputed_hash
       OR chain.previous_hash IS DISTINCT FROM chain.expected_previous_hash
    ORDER BY chain.id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Alt-Einträge ohne Hash nachverketten (No-Op, wenn bereits vollständig
-- verkettet). Der Immutable-Trigger kann schon existieren (Restore/Import einer
-- Tabelle mit unverketteten Zeilen) und würde das Backfill-UPDATE blockieren;
-- er wird dafür kurz deaktiviert. Die Migration läuft in einer Transaktion:
-- scheitert etwas, bleibt der Trigger aktiv.
DO $$
DECLARE
    offen INTEGER;
    trigger_vorhanden BOOLEAN;
BEGIN
    SELECT count(*) INTO offen FROM audit_log WHERE hash IS NULL;
    IF offen > 0 THEN
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'audit_log'::regclass AND tgname = 'trg_audit_log_immutable'
        ) INTO trigger_vorhanden;
        IF trigger_vorhanden THEN
            ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable;
        END IF;
        PERFORM backfill_audit_chain();
        IF trigger_vorhanden THEN
            ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable;
        END IF;
        RAISE NOTICE 'audit_log: % Alt-Einträge nachverkettet', offen;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_hash_chain'
    ) THEN
        CREATE TRIGGER trg_audit_log_hash_chain
            BEFORE INSERT ON audit_log
            FOR EACH ROW
            EXECUTE FUNCTION audit_log_hash_chain();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_immutable'
    ) THEN
        CREATE TRIGGER trg_audit_log_immutable
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH STATEMENT
            EXECUTE FUNCTION audit_log_prevent_tamper();
    END IF;
END
$$;

-- ---- Tabelle: app_users ----
-- Der Standard-Admin wird nicht hier, sondern nach den Migrationen im Runner
-- angelegt (bcrypt-Hash zur Laufzeit, auch wenn alle Benutzer gelöscht wurden).

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
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP DEFAULT NULL,
    reset_token_hash TEXT DEFAULT NULL,
    reset_token_expiry TIMESTAMP DEFAULT NULL,
    CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'bearbeiter', 'user'))
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'app_users' AND column_name = 'must_change_password'
    ) THEN
        ALTER TABLE app_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END
$$;

-- Account-Lockout und Passwort-Reset (Issue #137)
ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS reset_token_hash TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP DEFAULT NULL;

-- Rollen-Constraint älterer Installationen um 'bearbeiter' erweitern
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'app_users_role_check'
    ) THEN
        ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;
    END IF;
    ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('admin', 'bearbeiter', 'user'));
END
$$;

-- ---- Bestellübersicht (DSGVO): bestellung_kunde, bestellung, bestellung_consent ----

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

CREATE TABLE IF NOT EXISTS bestellung_kunde (
    id SERIAL PRIMARY KEY,
    kunde_pseudonym VARCHAR(20) NOT NULL UNIQUE,
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
-- name_enc darf NULL sein: die Anonymisierungsfunktion muss den Wert löschen können
ALTER TABLE bestellung_kunde ALTER COLUMN name_enc DROP NOT NULL;

CREATE TABLE IF NOT EXISTS bestellung (
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
    foto_pfad       VARCHAR(255) DEFAULT NULL,
    CONSTRAINT bestellung_wunschdatum_check
        CHECK (wunschdatum IS NULL OR wunschdatum >= erfassungsdatum::date)
);
CREATE INDEX IF NOT EXISTS idx_bestellung_kunde ON bestellung(kunde_id);
CREATE INDEX IF NOT EXISTS idx_bestellung_status ON bestellung(status);
CREATE INDEX IF NOT EXISTS idx_bestellung_erfassungsdatum ON bestellung(erfassungsdatum);
ALTER TABLE bestellung ADD COLUMN IF NOT EXISTS foto_pfad VARCHAR(255) DEFAULT NULL;
-- Die Anonymisierung leert die Beschreibung (Freitext kann PII enthalten)
ALTER TABLE bestellung ALTER COLUMN beschreibung DROP NOT NULL;

CREATE TABLE IF NOT EXISTS bestellung_consent (
    id SERIAL PRIMARY KEY,
    kunde_id            INTEGER NOT NULL REFERENCES bestellung_kunde(id),
    consent_typ         VARCHAR(50) NOT NULL DEFAULT 'datenverarbeitung_bestellung',
    consent_erteilt     BOOLEAN NOT NULL,
    consent_zeitpunkt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    datenschutz_version VARCHAR(20) NOT NULL,
    ip_hash             TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_bestellung_consent_kunde ON bestellung_consent(kunde_id);

CREATE OR REPLACE FUNCTION check_datenminimierung_versandart()
RETURNS TRIGGER AS $$
DECLARE
    hat_adresse BOOLEAN;
    hat_telefon BOOLEAN;
    ist_anonymisiert BOOLEAN;
BEGIN
    SELECT (strasse_enc IS NOT NULL AND hausnummer_enc IS NOT NULL
            AND plz_enc IS NOT NULL AND ort_enc IS NOT NULL),
           (telefonnummer_enc IS NOT NULL),
           anonymisiert
      INTO hat_adresse, hat_telefon, ist_anonymisiert
      FROM bestellung_kunde WHERE id = NEW.kunde_id;

    IF NOT ist_anonymisiert THEN
        IF NOT hat_telefon THEN
            RAISE EXCEPTION 'Telefonnummer ist erforderlich';
        END IF;
        IF NEW.versandart = 'lieferung' AND NOT hat_adresse THEN
            RAISE EXCEPTION 'Versandart "lieferung" erfordert eine vollständige Adresse (Art. 5 Abs. 1 lit. c DSGVO)';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_bestellung_aktualisiert()
RETURNS TRIGGER AS $$
BEGIN
    NEW.erfassungsdatum = OLD.erfassungsdatum;
    NEW.aktualisiert_am = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION anonymisiere_bestellung_kunde(p_kunde_id INTEGER)
RETURNS VOID AS $$
BEGIN
    DELETE FROM bestellung_foto
    WHERE datei_name IN (
        SELECT foto_pfad FROM bestellung
        WHERE kunde_id = p_kunde_id AND foto_pfad IS NOT NULL
    );

    UPDATE bestellung
    SET foto_pfad = NULL,
        beschreibung = NULL
    WHERE kunde_id = p_kunde_id;

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bestellung_datenminimierung'
    ) THEN
        CREATE TRIGGER trg_bestellung_datenminimierung
            BEFORE INSERT OR UPDATE ON bestellung
            FOR EACH ROW
            EXECUTE FUNCTION check_datenminimierung_versandart();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bestellung_aktualisiert'
    ) THEN
        CREATE TRIGGER trg_bestellung_aktualisiert
            BEFORE UPDATE ON bestellung
            FOR EACH ROW
            EXECUTE FUNCTION update_bestellung_aktualisiert();
    END IF;
END
$$;

-- ---- Tabelle: lagerinventur ----

CREATE TABLE IF NOT EXISTS lagerinventur (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES app_users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'entwurf',
    data JSONB NOT NULL,
    kommentar TEXT
);
CREATE INDEX IF NOT EXISTS idx_lagerinventur_user_status ON lagerinventur(user_id, status);

-- ---- Fotos (Issue #208): Bilddaten in der Datenbank statt im Dateisystem ----
-- Eigene Tabellen statt BYTEA-Spalte, damit SELECT * auf "Schmuckstück" keine
-- Bilddaten lädt. Kein Fremdschlüssel: ein Foto gilt für alle Stücke einer
-- Basis-Artikelnummer (MHO123 für MHO123_1, MHO123_2, …), und das
-- Anlage-Formular lädt das Foto hoch, bevor das Stück gespeichert ist.

CREATE TABLE IF NOT EXISTS "Foto" (
    "Artikelnummer" VARCHAR(20) PRIMARY KEY,
    "Daten"         BYTEA NOT NULL,
    "MimeType"      TEXT NOT NULL,
    "Groesse"       INTEGER NOT NULL,
    "Geaendert"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bestellung_foto (
    datei_name VARCHAR(255) PRIMARY KEY,
    daten      BYTEA NOT NULL,
    mime_type  TEXT NOT NULL,
    groesse    INTEGER NOT NULL,
    geaendert  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Schmuckstück"."Foto" hielt Dateinamen aus der Zeit vor #208. Ob ein Stück
-- ein Foto hat, entscheidet seit #214 allein die Tabelle "Foto".
ALTER TABLE "Schmuckstück" DROP COLUMN IF EXISTS "Foto";
