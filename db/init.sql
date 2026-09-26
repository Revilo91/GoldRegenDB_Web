-- GoldRegenDB PostgreSQL Schema
-- Migriert von MariaDB/MySQL

-- Für die Hash-Kette des audit_log (digest/encode), siehe Issue #139
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

-- Tamper-Schutz audit_log (Issue #139): Hash-Kette + Immutabilität.
-- Jede Zeile verkettet sich per SHA-256 mit dem Hash ihres Vorgängers, sodass
-- nachträgliches Löschen/Ändern (auch außerhalb der App, z.B. per psql) beim
-- Verifizieren als Bruch der Kette erkennbar wird. pg_advisory_xact_lock
-- serialisiert gleichzeitige INSERTs, damit die Kette nicht durch eine Race
-- Condition verzweigt.
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

-- Blockiert UPDATE/DELETE auf audit_log unabhängig von der ausführenden Rolle.
-- FOR EACH STATEMENT genügt: der Trigger braucht keine Zeilendaten, er soll
-- jeden UPDATE/DELETE-Befehl kategorisch verhindern (auch bei 0 betroffenen
-- Zeilen) – das ist günstiger als FOR EACH ROW und deckt denselben Fall ab.
CREATE OR REPLACE FUNCTION audit_log_prevent_tamper()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log ist unveränderlich (Tamper-Schutz, Issue #139): % ist nicht erlaubt', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Rekonstruiert previous_hash/hash für Zeilen, die noch keinen Hash haben
-- (Alt-Einträge aus Bestandsinstallationen). Muss vor dem Anlegen von
-- trg_audit_log_immutable laufen, sonst blockiert der Trigger sein eigenes
-- UPDATE. Bei bereits vollständig verketteten Tabellen ein No-Op.
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

-- Prüft die gesamte Kette: liefert jede Zeile, deren gespeicherter Hash nicht
-- mehr zum Inhalt passt (hash_mismatch, d.h. UPDATE am Rohwert vorbei) oder
-- deren previous_hash nicht zum Hash der Vorgängerzeile passt (chain_broken,
-- d.h. eine Zeile fehlt/wurde gelöscht). Leeres Ergebnis = Kette intakt.
-- LANGUAGE plpgsql statt sql: eine SQL-Funktion würde beim CREATE FUNCTION
-- sofort geparst und bräuchte audit_log dafür schon vorhanden – plpgsql
-- löst das erst beim ersten Aufruf auf, unabhängig von der Anlage-Reihenfolge.
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

-- ============================================================
-- Tabellen
-- ============================================================

CREATE TABLE "Kunde" (
    "ID" SERIAL,
    "Name" VARCHAR(100) NOT NULL,
    "Strasse" TEXT NOT NULL,
    -- Text statt INTEGER (Issue #211): "12a", "3-5b" sind echte Hausnummern.
    -- Leerstring = nicht gepflegt (Messe, Online).
    "Hausnummer" TEXT NOT NULL DEFAULT '',
    "Ort" TEXT NOT NULL,
    "PLZ" INTEGER NOT NULL,
    "Email" TEXT DEFAULT NULL,
    "Telefonnummer" TEXT DEFAULT NULL,
    "Provision" INTEGER NOT NULL DEFAULT 0,
    -- Befund B6: Default war FALSE, ein neu angelegter Kunde also inaktiv.
    -- Das war nicht beabsichtigt.
    "Aktiv" BOOLEAN NOT NULL DEFAULT TRUE,
    -- E-Rechnung (EN 16931): Ländercode BT-55, USt-IdNr. BT-48, Leitweg-ID/Käuferreferenz BT-10
    "Land" CHAR(2) NOT NULL DEFAULT 'DE',
    "UStIdNr" VARCHAR(20) DEFAULT NULL,
    "Leitweg_ID" VARCHAR(50) DEFAULT NULL,
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

-- Ohne diese Indizes muss jedes DELETE auf "Kunde" die ganze Tabelle scannen,
-- um den Fremdschlüssel zu prüfen, und die Default-Sortierung der Dokumentliste
-- (ORDER BY "Datum" DESC) sortiert bei jedem Aufruf neu (Befund B11).
CREATE INDEX idx_lieferschein_kundennummer ON "Lieferschein" ("Kundennummer");
CREATE INDEX idx_lieferschein_datum ON "Lieferschein" ("Datum" DESC);

CREATE TABLE "Rechnung" (
    "ID" SERIAL,
    "Nummer" VARCHAR(20) NOT NULL,
    "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'final',
    PRIMARY KEY ("Nummer"),
    -- "Schmuckstück"."Rechnung_ID" zeigt auf diese Spalte. Ohne Eindeutigkeit
    -- könnten zwei Rechnungen dieselbe "ID" tragen und jeder JOIN darüber die
    -- Positionen beider mischen (Befund B4). "Lieferschein" hatte das UNIQUE
    -- von Anfang an, "Rechnung" nicht – die Asymmetrie kam aus MySQL.
    CONSTRAINT rechnung_id_key UNIQUE ("ID"),
    CONSTRAINT "Rechnung_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
);

-- Kein separater Index auf "ID": der UNIQUE-Constraint bringt ihn mit.
CREATE INDEX idx_rechnung_kundennummer ON "Rechnung" ("Kundennummer");
CREATE INDEX idx_rechnung_datum ON "Rechnung" ("Datum" DESC);

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
    -- Geld ist numeric, nie float (Befund B1): 19.99 ist binaer nicht exakt
    -- darstellbar, 37 Positionen a 19,99 EUR ergaben 739.6299999999999.
    -- pg liefert numeric bewusst als String, Number() erst an der Anzeigekante.
    "Herstellungskosten" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "Verkaufspreis" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "Ausgelagert" INTEGER DEFAULT 0,
    -- Booleans, nicht SMALLINT (Befund B6): als nullable SMALLINT waren
    -- Verkauft = 2 und NULL erlaubt, und so eine Zeile war in KEINEM Filter
    -- enthalten -- weder "verkauft" (= 1) noch "verfügbar" (= 0, denn NULL = 0
    -- ist UNKNOWN). Der Artikel verschwand lautlos aus allen Listen, zählte
    -- aber weiter in totalPieces.
    "Verkauft" BOOLEAN NOT NULL DEFAULT FALSE,
    "Ausschuss" BOOLEAN NOT NULL DEFAULT FALSE,
    "Ausschuss_Grund" TEXT DEFAULT NULL,
    "Lieferschein_ID" INTEGER DEFAULT 0,
    "Rechnung_ID" INTEGER DEFAULT 0,
    "Erstelldatum" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Letzte_Änderung" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Artikelnummer"),
    -- Verkauft UND Ausschuss gleichzeitig ist in keinem Status-Mapping
    -- vorgesehen: die Zeile zählt in der Inventur doppelt und im Dashboard nur
    -- als Ausschuss. Im Bestand gab es 28 solche Zeilen, siehe
    -- db/status_widerspruch_2026-09.csv und ensureStatusBooleans() in
    -- backend/src/config/db.js.
    CONSTRAINT schmuck_status_chk CHECK (NOT ("Verkauft" AND "Ausschuss")),
    CONSTRAINT schmuck_preis_nicht_negativ
      CHECK ("Verkaufspreis" >= 0 AND "Herstellungskosten" >= 0),
    -- Normalisiert wird im zod-Schema (backend/src/schemas/common.js), die
    -- Datenbank sichert es ab (Befund D4): 'mho123' waere ueber
    -- SUBSTRING(...,1,1) = 'm' in keinem Hersteller-, Grundmaterial- oder
    -- Produktartfilter gelandet -- und als Primaerschluessel eine zweite Zeile
    -- fuer dasselbe physische Schmuckstueck.
    CONSTRAINT schmuck_artikelnummer_gross_chk
      CHECK ("Artikelnummer" = UPPER("Artikelnummer"))
);

CREATE INDEX idx_schmuck_ausgelagert ON "Schmuckstück" ("Ausgelagert");
CREATE INDEX idx_schmuck_lieferschein ON "Schmuckstück" ("Lieferschein_ID");
CREATE INDEX idx_schmuck_rechnung ON "Schmuckstück" ("Rechnung_ID");
-- Sortierreihenfolge der Listenansicht (length + Artikelnummer)
CREATE INDEX idx_schmuck_artikelnummer_sort ON "Schmuckstück" (length("Artikelnummer"), "Artikelnummer");
-- Statusfilter aus dem whereClauseBuilder
CREATE INDEX idx_schmuck_status ON "Schmuckstück" ("Verkauft", "Ausschuss", "Ausgelagert");

-- Fotos (Issue #208): Bilddaten in der Datenbank statt im Dateisystem.
-- Eigene Tabelle, damit SELECT * auf "Schmuckstück" keine Bilddaten lädt.
-- Schlüssel ist die Basis-Artikelnummer (MHO123 gilt für MHO123_1, MHO123_2, …),
-- deshalb kein Fremdschlüssel auf "Schmuckstück".
CREATE TABLE "Foto" (
    "Artikelnummer" VARCHAR(20) PRIMARY KEY,
    "Daten"         BYTEA NOT NULL,
    "MimeType"      TEXT NOT NULL,
    "Groesse"       INTEGER NOT NULL,
    "Geaendert"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(255) NOT NULL,
    artikelnummer_id VARCHAR(20) DEFAULT NULL,
    column_name VARCHAR(255) DEFAULT NULL,
    old_value TEXT DEFAULT NULL,
    new_value TEXT DEFAULT NULL,
    action_type VARCHAR(10) NOT NULL,
    changed_by VARCHAR(255) DEFAULT NULL,
    change_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Hash-Kette (Issue #139), siehe audit_log_hash_chain() / verify_audit_chain()
    previous_hash CHAR(64) DEFAULT NULL,
    hash CHAR(64) DEFAULT NULL
);

-- Die Tabelle wächst unbegrenzt und wird durchweg nach Zeitstempel abgefragt:
--   dashboard.js:139  ORDER BY change_timestamp DESC LIMIT 10 (jeder Aufruf)
--   auditLog.js:62    ORDER BY change_timestamp DESC LIMIT/OFFSET
--   auditLog.js:139   WHERE artikelnummer_id = $1 ORDER BY ts DESC
-- Ohne Index war jede dieser Abfragen ein Seq Scan mit vollständigem Sort
-- (Befund B11).
CREATE INDEX idx_audit_ts ON audit_log (change_timestamp DESC);
CREATE INDEX idx_audit_artikel ON audit_log (artikelnummer_id, change_timestamp DESC);

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
    -- Account-Lockout nach zu vielen Fehlversuchen (siehe backend/src/routes/auth.js)
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP DEFAULT NULL,
    -- Passwort-Reset: gespeichert wird nur der SHA-256-Hash des Tokens
    reset_token_hash TEXT DEFAULT NULL,
    reset_token_expiry TIMESTAMP DEFAULT NULL,
    CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'bearbeiter', 'user'))
);

-- Passwort: admin – bcrypt(10 Rounds). must_change_password erzwingt die Änderung beim ersten Login.
INSERT INTO app_users (username, password_hash, email, role, active, must_change_password)
VALUES ('admin', '$2b$10$wWDJzVKVbWUTZJYchdYW8OOZwhEwqmN/JBFKT4jETDbVbE0yyciGm', 'admin@goldregen.local', 'admin', TRUE, TRUE)
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

-- Tamper-Schutz audit_log (Issue #139). backfill_audit_chain() muss vor
-- trg_audit_log_immutable laufen (Neuinstallation: audit_log ist noch leer,
-- also No-Op) – siehe Kommentar bei backfill_audit_chain().
SELECT backfill_audit_chain();

CREATE TRIGGER trg_audit_log_hash_chain
    BEFORE INSERT ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_hash_chain();

CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH STATEMENT
    EXECUTE FUNCTION audit_log_prevent_tamper();

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
    -- Vom Kunden übermitteltes Referenzfoto (Schlüssel in bestellung_foto), optional.
    foto_pfad       VARCHAR(255) DEFAULT NULL,
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

-- Referenzfotos aus dem Bestellformular, Schlüssel = bestellung.foto_pfad.
CREATE TABLE bestellung_foto (
    datei_name VARCHAR(255) PRIMARY KEY,
    daten      BYTEA NOT NULL,
    mime_type  TEXT NOT NULL,
    groesse    INTEGER NOT NULL,
    geaendert  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
