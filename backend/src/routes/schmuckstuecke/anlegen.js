const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { validate } = require("../../middleware/validate");
const { schmuckstueckCreateSchema } = require("../../schemas");
const {
  AUSSCHUSS_GRUND_CONSTRAINT,
  resolveAusschussGrund,
} = require("../../services/schmuckstueckService");

/**
 * @swagger
 * /schmuckstuecke:
 *   post:
 *     summary: Schmuckstück(e) anlegen
 *     description: 'Artikelnummer akzeptiert drei Kurzformen: nur Präfix (z. B. MHO -> nächste freie
 *       Nummer wird vergeben), Präfix+Nummer ohne Suffix (z. B. MHO123 -> nächster freier Suffix), oder
 *       eine vollständige Nummer mit Suffix. Bei Anzahl > 1 werden mehrere Exemplare mit fortlaufendem
 *       Suffix angelegt und Attribute vom letzten existierenden Exemplar übernommen, sofern eines
 *       existiert. Erfordert eine gültige Anmeldung (jede Rolle, auch user – siehe CLAUDE.md Rollen).'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [Artikelnummer]
 *             properties:
 *               Artikelnummer:
 *                 type: string
 *                 example: MHO
 *                 description: 'Präfix, Präfix+Nummer, oder vollständige Nummer'
 *               Anzahl: { type: integer, minimum: 1, maximum: 200, default: 1 }
 *               Name: { type: string, nullable: true }
 *               Art: { type: string, nullable: true }
 *               Form: { type: string, nullable: true }
 *               Material: { type: string, nullable: true }
 *               Farbe: { type: string, nullable: true }
 *               Länge: { type: number, nullable: true }
 *               Grösse: { type: number, nullable: true }
 *               Herstellungskosten: { type: number, nullable: true }
 *               Verkaufspreis: { type: number, nullable: true }
 *               Ausschuss: { type: boolean }
 *               Ausschuss_Grund: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Erstelltes Schmuckstück (Anzahl=1) oder Liste (Anzahl>1)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Schmuckstueck'
 *                 - { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/", validate(schmuckstueckCreateSchema), async (req, res) => {
  let client;
  try {
    client = await db.connect();
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Herstellen der DB-Verbindung", {
      message: err.message,
    });
    return res
      .status(500)
      .json({ error: "Fehler beim Herstellen der Datenbankverbindung" });
  }
  try {
    const b = req.body;
    const ausschussGrundValue = resolveAusschussGrund(
      b.Ausschuss,
      b.Ausschuss_Grund,
    );
    const quantity = parseInt(b.Anzahl) || 1;
    let baseArtikelnummer = b.Artikelnummer.trim();
    let startSuffix = 1;

    await client.query("BEGIN");

    // baseArtikelnummer ist bereits normalisiert (zod, Befund D4) -- die
    // toUpperCase-Aufrufe in diesem Block sind deshalb entfallen.
    // Case 1: Prefix only (3 chars, e.g. "MHO")
    if (baseArtikelnummer.length === 3) {
      const prefix = baseArtikelnummer;
      const { rows } = await client.query(
        `SELECT MAX(CAST(SUBSTRING("Artikelnummer", 4, 3) AS INTEGER)) as max_num
         FROM "Schmuckstück"
         WHERE "Artikelnummer" LIKE $1`,
        [`${prefix}%`],
      );
      const nextNum = (rows[0].max_num || 0) + 1;
      baseArtikelnummer = prefix + nextNum.toString().padStart(3, "0");
    }
    // Case 2: Base Artikelnummer (e.g. "MHO112")
    else if (/^[A-Z]{3}\d{3}$/.test(baseArtikelnummer)) {
      const { rows } = await client.query(
        `SELECT MAX(CAST(SUBSTRING("Artikelnummer", 8) AS INTEGER)) as max_suffix
         FROM "Schmuckstück"
         WHERE "Artikelnummer" LIKE $1`,
        [`${baseArtikelnummer}_%`],
      );
      startSuffix = (rows[0].max_suffix || 0) + 1;
    } else if (baseArtikelnummer.includes("_")) {
      // If they provided a full number with suffix, just use it as is (quantity will still work but might collide)
      const parts = baseArtikelnummer.split("_");
      baseArtikelnummer = parts[0];
      startSuffix = parseInt(parts[1]) || 1;
    }

    // Befund C11: der Kommentar hier sagte "Daten von Produkt holen, sobald das
    // form nicht ausgefüllt ist" -- geprüft wurde das nie. Die Bedingung war
    // `if (b.Artikelnummer)`, und Artikelnummer ist Pflichtfeld, also IMMER
    // wahr. Wer ein weiteres Exemplar mit korrigiertem Preis oder Namen anlegte,
    // bekam stillschweigend die Werte des Vorgängers -- die Eingabe war weg,
    // ohne Meldung.
    //
    // Jetzt gilt, was der Kommentar behauptete: übernommen wird nur, was der
    // Client NICHT geschickt hat. Wer nichts vorgeben will, bekommt wie bisher
    // die Werte des Vorgängers; wer etwas eingibt, behält es.
    const UEBERNEHMBARE_FELDER = [
      'Name', 'Art', 'Material', 'Farbe', 'Verkaufspreis',
      'Herstellungskosten', 'Länge', 'Fassung', 'Inhalt_Material',
      'Inhalt_Farbe', 'Inhalt_Farbakzent', 'Inhalt_Zusatzmaterial',
      'Anhänger_Fassung', 'Anhänger_Form', 'Anhänger_Farbe', 'Anhänger_Grösse',
      'Anhänger_Inhalt_Material', 'Anhänger_Inhalt_Farbe',
      'Anhänger_Inhalt_Farbakzente', 'Anhänger_Inhalt_Zusatzmaterial',
      'Grösse', 'Anhänger', 'Zwischenstück',
      // "Ausschuss_Grund" steht hier bewusst NICHT: er wurde vom Vorgänger
      // kopiert, während b.Ausschuss auf false erzwungen wird -- das ergab
      // Datensätze mit Ausschussgrund, die kein Ausschuss sind.
    ];

    if (b.Artikelnummer) {
      const { rows } = await client.query(
        `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 || '_' || $2`,
        [baseArtikelnummer, startSuffix - 1],
      );
      if (rows.length > 0) {
        const vorgaenger = rows[0];
        for (const feld of UEBERNEHMBARE_FELDER) {
          const eingabe = b[feld];
          const leer = eingabe === undefined || eingabe === null || eingabe === '';
          if (leer) {
            b[feld] = vorgaenger[feld];
          }
        }
        // Ein Duplikat startet immer im Lager, unabhängig vom Vorgänger.
        b.Ausgelagert = 0;
        b.Verkauft = false;
        b.Ausschuss = false;
      }
    }
    const createdItems = [];
    for (let i = 0; i < quantity; i++) {
      const fullArtNr = `${baseArtikelnummer}_${startSuffix + i}`;
      const { rows } = await client.query(
        `INSERT INTO "Schmuckstück" (
            "Artikelnummer", "Name", "Art", "Form", "Länge", "Fassung", "Farbe",
            "Inhalt_Material", "Inhalt_Farbe", "Inhalt_Farbakzent", "Inhalt_Zusatzmaterial",
            "Anhänger_Fassung", "Anhänger_Form", "Anhänger_Farbe", "Anhänger_Grösse",
            "Anhänger_Inhalt_Material", "Anhänger_Inhalt_Farbe", "Anhänger_Inhalt_Farbakzente",
            "Anhänger_Inhalt_Zusatzmaterial", "Material", "Grösse", "Anhänger", "Zwischenstück",
            "Herstellungskosten", "Verkaufspreis", "Ausgelagert", "Verkauft", "Ausschuss", "Ausschuss_Grund"
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
          ) RETURNING *`,
        [
          fullArtNr,
          b.Name,
          b.Art,
          b.Form,
          b.Länge || 0,
          b.Fassung,
          b.Farbe,
          b.Inhalt_Material,
          b.Inhalt_Farbe,
          b.Inhalt_Farbakzent,
          b.Inhalt_Zusatzmaterial,
          b.Anhänger_Fassung,
          b.Anhänger_Form,
          b.Anhänger_Farbe,
          b.Anhänger_Grösse || 0,
          b.Anhänger_Inhalt_Material,
          b.Anhänger_Inhalt_Farbe,
          b.Anhänger_Inhalt_Farbakzente,
          b.Anhänger_Inhalt_Zusatzmaterial,
          b.Material,
          b.Grösse || 0,
          b.Anhänger,
          b.Zwischenstück,
          b.Herstellungskosten || 0,
          b.Verkaufspreis || 0,
          b.Ausgelagert || 0,
          b.Verkauft ?? false,
          b.Ausschuss ?? false,
          ausschussGrundValue,
        ],
      );
      createdItems.push(rows[0]);
      await client.query(
        `INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
           VALUES ('Schmuckstück', $1, 'Erstellung', NULL, $2, 'INSERT', COALESCE(current_setting('app.current_user', true), current_user))`,
        [fullArtNr, JSON.stringify(rows[0])],
      );
    }

    await client.query("COMMIT");
    res.status(201).json(quantity === 1 ? createdItems[0] : createdItems);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23514" && err.constraint === AUSSCHUSS_GRUND_CONSTRAINT) {
      return res.status(400).json({
        error:
          "Wenn ein Schmuckstueck als Ausschuss markiert ist, muss ein Ausschuss Grund angegeben werden.",
      });
    }
    logger.error("SCHMUCK", "Fehler beim Erstellen des Schmuckstücks", {
      message: err.message,
    });
    res.status(500).json({
      error: "Fehler beim Erstellen des Schmuckstücks: " + err.message,
    });
  } finally {
    client.release();
  }
});

module.exports = router;
