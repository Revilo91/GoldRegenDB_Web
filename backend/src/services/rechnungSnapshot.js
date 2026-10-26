const { belegSummen } = require('../utils/rabatt');

// Schreibt Positionen und Summen einer NICHT finalen Rechnung neu. Aufrufer
// halten die Zeile gesperrt (ladeRechnungGesperrt) bzw. legen sie gerade an.
// live: true ist Pflicht -- sonst läse belegSummen den Snapshot, den wir gerade erst schreiben
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
  const summen = await belegSummen(client, 'Rechnung', rechnungId, { live: true });
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

// Spalten für die Stücke-Abfragen der Leser (LEFT JOIN auf den Snapshot)
const SNAPSHOT_SPALTEN = 'p.einzelpreis AS snapshot_einzelpreis, p.positionsrabatt AS snapshot_positionsrabatt';
const SNAPSHOT_JOIN = `LEFT JOIN "Rechnung_Position" p
  ON p.rechnung_id = s."Rechnung_ID" AND p.artikelnummer_id = s."Artikelnummer"`;

const istEingefroren = (rechnung) => rechnung.status === 'final' && rechnung.snapshot_am != null;

// Gespeicherter Prozentwert, solange er den gespeicherten Betrag reproduziert (Normalfall);
// wurde rabatt_gesamt nachträglich verändert, wird er aus dem Betrag zurückgerechnet
function eingefrorenerRabattProzent(rechnung) {
  const live = Number(rechnung.rabatt_gesamt) || 0;
  const brutto = Number(rechnung.summe_brutto) || 0;
  const betrag = Number(rechnung.rabatt_gesamt_betrag) || 0;
  if (brutto <= 0) return live;
  if (Math.round(brutto * live) === Math.round(betrag * 100)) return live;
  return Math.round((betrag / brutto) * 10000) / 100;
}

// Legt bei finalen Rechnungen mit Snapshot den gespeicherten Stand über Preise, Rabatte,
// Provision und Versand; Entwürfe und Rechnungen ohne Snapshot kommen unverändert zurück.
// stuecke stammen aus einer Abfrage mit SNAPSHOT_SPALTEN/SNAPSHOT_JOIN.
function wendeSnapshotAn(rechnung, stuecke) {
  if (!istEingefroren(rechnung)) return { rechnung, stuecke, provisionProzent: null };
  const rabattPositionen = {};
  const eingefroren = stuecke.map((s) => {
    const basis = String(s.Artikelnummer).split('_')[0];
    if (s.snapshot_einzelpreis == null) {
      if (rechnung.rabatt_positionen?.[basis] != null) rabattPositionen[basis] = rechnung.rabatt_positionen[basis];
      return s;
    }
    rabattPositionen[basis] = Number(s.snapshot_positionsrabatt);
    return { ...s, Verkaufspreis: s.snapshot_einzelpreis };
  });
  return {
    rechnung: {
      ...rechnung,
      rabatt_positionen: rabattPositionen,
      rabatt_gesamt: eingefrorenerRabattProzent(rechnung),
      versandkosten: rechnung.versand_betrag,
    },
    stuecke: eingefroren,
    provisionProzent: rechnung.provision_prozent,
  };
}

module.exports = {
  schreibeSnapshot, leereSnapshot, wendeSnapshotAn, istEingefroren, SNAPSHOT_SPALTEN, SNAPSHOT_JOIN,
};
