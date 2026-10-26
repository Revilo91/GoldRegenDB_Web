const { belegSummen } = require('../utils/rabatt');

// Schreibt Positionen und Summen einer NICHT finalen Rechnung neu. Aufrufer
// halten die Zeile gesperrt (ladeRechnungGesperrt) bzw. legen sie gerade an.
async function schreibeSnapshot(client, rechnungId) {
  await client.query('DELETE FROM "Rechnung_Position" WHERE rechnung_id = $1', [rechnungId]);
  await client.query(
    `INSERT INTO "Rechnung_Position"
       (rechnung_id, artikelnummer_id, basis_artikelnummer, einzelpreis, positionsrabatt)
     SELECT r."ID", s."Artikelnummer", split_part(s."Artikelnummer", '_', 1), s."Verkaufspreis",
            COALESCE(NULLIF(r.rabatt_positionen ->> split_part(s."Artikelnummer", '_', 1), '')::numeric, 0)
     FROM "Rechnung" r
     JOIN "Schmuckstück" s ON s."Rechnung_ID" = r."ID"
     WHERE r."ID" = $1`,
    [rechnungId]
  );
  const summen = await belegSummen(client, 'Rechnung', rechnungId);
  if (!summen) throw new Error(`Snapshot: Rechnung ${rechnungId} nicht gefunden`);
  await client.query(
    `UPDATE "Rechnung"
     SET summe_brutto = $2, rabatt_gesamt_betrag = $3, provision_prozent = $4,
         provision_betrag = $5, versand_betrag = $6, summe_ueberweisung = $7, snapshot_am = now()
     WHERE "ID" = $1`,
    [
      rechnungId, summen.gesamtwert, summen.gesamtrabatt_betrag, summen.provision,
      summen.provision_betrag, summen.versandkosten, summen.ueberweisungsbetrag,
    ]
  );
}

// Admin-Reset: die Rechnung ist wieder ein Entwurf und wird beim nächsten Speichern neu eingefroren
async function leereSnapshot(client, rechnungId) {
  await client.query('DELETE FROM "Rechnung_Position" WHERE rechnung_id = $1', [rechnungId]);
  await client.query(
    `UPDATE "Rechnung"
     SET summe_brutto = NULL, rabatt_gesamt_betrag = NULL, provision_prozent = NULL,
         provision_betrag = NULL, versand_betrag = NULL, summe_ueberweisung = NULL, snapshot_am = NULL
     WHERE "ID" = $1`,
    [rechnungId]
  );
}

module.exports = { schreibeSnapshot, leereSnapshot };
