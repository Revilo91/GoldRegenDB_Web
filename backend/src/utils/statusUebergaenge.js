// Zentrale Statusübergänge für "Schmuckstück" (UPDATE). Filter auf den Status
// gehören in whereClauseBuilder. Jeder Helper bekommt den Client der laufenden
// Transaktion (bzw. db), damit der Audit-Trigger unverändert greift.
const { where } = require('./whereClauseBuilder');

const leer = (liste) => !Array.isArray(liste) || liste.length === 0;

async function markiereVerkauft(client, artikelnummern, rechnungId) {
  if (leer(artikelnummern)) return 0;
  const { rowCount } = await client.query(
    `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = TRUE WHERE "Artikelnummer" = ANY($2::text[])`,
    [rechnungId, artikelnummern]
  );
  return rowCount;
}

async function hebeVerkauftAuf(client, rechnungId) {
  const { rowCount } = await client.query(
    `UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = FALSE WHERE "Rechnung_ID" = $1`,
    [rechnungId]
  );
  return rowCount;
}

async function lagereAus(client, artikelnummern, kundeId, lieferscheinId) {
  if (leer(artikelnummern)) return 0;
  const { rowCount } = await client.query(
    `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
    [lieferscheinId, kundeId, artikelnummern]
  );
  return rowCount;
}

// Wie lagereAus, aber nur für Stücke ohne Verkauft-/Ausschuss-Status (SumUp-Import)
async function lagereOffeneAus(client, artikelnummern, kundeId, lieferscheinId) {
  if (leer(artikelnummern)) return 0;
  const builder = where(3);
  builder.artikelnummerIn(artikelnummern);
  builder.nichtVerkauft();
  builder.keinAusschuss();
  const { rowCount } = await client.query(
    `UPDATE "Schmuckstück" SET "Ausgelagert" = $1, "Lieferschein_ID" = $2 ${builder.build()}`,
    [kundeId, lieferscheinId, ...builder.getParams()]
  );
  return rowCount;
}

async function hebeAuslagerungAuf(client, lieferscheinId) {
  const { rowCount } = await client.query(
    `UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0 WHERE "Lieferschein_ID" = $1`,
    [lieferscheinId]
  );
  return rowCount;
}

// Nur aktiv beim Kunden ausgelagerte Stücke (nicht verkaufte, kein Ausschuss); ohne Liste: alle davon
async function lagereZurueck(client, kundeId, artikelnummern = null) {
  const builder = where();
  if (artikelnummern !== null) {
    if (leer(artikelnummern)) return 0;
    builder.artikelnummerIn(artikelnummern);
  }
  builder.aktivAusgelagert(kundeId);
  const { rowCount } = await client.query(
    `UPDATE "Schmuckstück" SET "Ausgelagert" = 0, "Lieferschein_ID" = 0 ${builder.build()}`,
    builder.getParams()
  );
  return rowCount;
}

module.exports = {
  markiereVerkauft,
  hebeVerkauftAuf,
  lagereAus,
  lagereOffeneAus,
  hebeAuslagerungAuf,
  lagereZurueck,
};
