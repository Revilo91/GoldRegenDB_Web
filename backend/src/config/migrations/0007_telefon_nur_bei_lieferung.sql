-- Telefonnummer ist nur noch bei Lieferung Pflicht (#328, Datenminimierung).
-- Bestehende Daten bleiben unverändert; die Regel wird nur gelockert.
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

    IF NOT ist_anonymisiert AND NEW.versandart = 'lieferung' THEN
        IF NOT hat_telefon THEN
            RAISE EXCEPTION 'Versandart "lieferung" erfordert eine Telefonnummer (Art. 5 Abs. 1 lit. c DSGVO)';
        END IF;
        IF NOT hat_adresse THEN
            RAISE EXCEPTION 'Versandart "lieferung" erfordert eine vollständige Adresse (Art. 5 Abs. 1 lit. c DSGVO)';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
