// @ts-check
'use strict';

// Rabattlogik an EINER Stelle (Befund C17, C18, G7).
//
// Rabatte wurden bisher ausschliesslich in excelService.js angewandt. Drei
// andere Stellen rechneten deshalb zu hoch oder widerspruechlich:
//   - dashboard.js: totalRevenue und der Monatsumsatz ignorierten sie.
//   - inventur.js: wert_verkauft ebenso.
//   - DocumentManager.jsx: die Auszahlungsaufteilung je Herstellerin summierte
//     rohe Preise -- und das ist die Zahl, nach der abgerechnet wird.
//
// Die Reihenfolge ist NICHT erfunden, sondern aus dem Beleg uebernommen, den
// der Kunde bekommt (excelService.js, Abschnitt "Total Block"):
//
//   Gesamtwert         = SUMME( Einzelpreis * (1 - Positionsrabatt/100) )
//   - Gesamtrabatt     = Gesamtwert * (Gesamtrabatt/100)
//   Summe nach Rabatt  = Gesamtwert - Gesamtrabatt
//   - Provision        = Summe nach Rabatt * (Provision/100)
//   + Versandkosten    = fester Betrag, optional
//   Ueberweisungsbetrag = Summe nach Rabatt - Provision + Versandkosten
//
// Versandkosten sind durchgereichte Kosten: weder Rabatt noch Provision
// greifen auf sie, und sie gehoeren keiner Herstellerin.
//
// rabatt_positionen ist nach BASIS-Artikelnummer geschluesselt (MHO123, nicht
// MHO123_1), deshalb split_part(..., '_', 1).

/**
 * SQL-Ausdruck fuer den Einzelpreis nach Positionsrabatt.
 *
 * Alle Faktoren sind numeric, die Rechnung bleibt also exakt -- anders als bei
 * DOUBLE PRECISION, wo sich der Fehler ueber die Positionen aufsummierte
 * (Befund B1).
 *
 * @param {string} [s='s'] Alias der Schmuckstueck-Tabelle
 * @param {string} [r='r'] Alias der Rechnung-Tabelle (LEFT JOIN erlaubt)
 * @returns {string}
 */
function preisNachPositionsrabattSql(s = 's', r = 'r') {
  return `${s}."Verkaufspreis" * (1 - COALESCE(
    NULLIF(${r}.rabatt_positionen ->> split_part(${s}."Artikelnummer", '_', 1), '')::numeric,
    0) / 100)`;
}

// Finale Rechnung mit eingefrorenem Stand (Issue #283): Entwuerfe und Rechnungen
// ohne Snapshot rechnen weiter live. r ist der Alias der Rechnung (LEFT JOIN).
/** @param {string} r */
const snapshotAktivSql = (r) => `${r}.status = 'final' AND ${r}.snapshot_am IS NOT NULL`;

/**
 * SQL-Ausdruck fuer den Einzelpreis nach Positions- UND Gesamtrabatt.
 * Mathematisch ist SUMME(p) * (1-g) gleich SUMME(p * (1-g)), der Faktor darf
 * also je Zeile stehen -- das erlaubt die Verwendung in FILTER und GROUP BY.
 *
 * Bei finalen Rechnungen mit Snapshot kommen Preis und Positionsrabatt aus
 * "Rechnung_Position", der Gesamtrabattfaktor aus den gespeicherten Betraegen
 * (1 - rabatt_gesamt_betrag / summe_brutto). Spaetere Aenderungen an
 * Verkaufspreis oder Rabatten wirken dort nicht mehr. Ohne Snapshot bleibt die
 * Live-Formel; die Signatur und die benoetigten JOINs sind unveraendert.
 *
 * @param {string} [s='s']
 * @param {string} [r='r']
 * @returns {string}
 */
function preisNachAllenRabattenSql(s = 's', r = 'r') {
  const live = `(${preisNachPositionsrabattSql(s, r)})`
    + ` * (1 - COALESCE(${r}.rabatt_gesamt, 0) / 100)`;
  const eingefroren = `COALESCE((SELECT p.einzelpreis * (1 - p.positionsrabatt / 100)
        FROM "Rechnung_Position" p
        WHERE p.rechnung_id = ${r}."ID" AND p.artikelnummer_id = ${s}."Artikelnummer"),
      ${preisNachPositionsrabattSql(s, r)})
    * COALESCE(1 - ${r}.rabatt_gesamt_betrag / NULLIF(${r}.summe_brutto, 0), 1)`;
  return `(CASE WHEN ${snapshotAktivSql(r)} THEN ${eingefroren} ELSE ${live} END)`;
}

/**
 * Einzelpreis nach Positionsrabatt in JavaScript, auf Cent gerundet.
 * Fuer die Positionszeilen des Belegs -- die Summen kommen aus SQL.
 *
 * @param {string|number|null|undefined} preis
 * @param {string|number|null|undefined} rabattProzent
 * @returns {number}
 */
function preisNachPositionsrabatt(preis, rabattProzent) {
  const p = Number(preis) || 0;
  const rabatt = Number(rabattProzent) || 0;
  if (rabatt <= 0) return p;
  return Math.round(p * (1 - rabatt / 100) * 100) / 100;
}

// Belegtypen fuer belegSummen(). "Lieferschein" hat keine Rabattspalten, dort
// ist der Rabatt 0 -- sonst dieselbe Rechnung, damit das Modal fuer beide
// Belege gleich aussieht (#241: der Lieferschein lieferte gar keine Summen).
const BELEGE = {
  Rechnung: { fk: 'Rechnung_ID', mitRabatt: true },
  Lieferschein: { fk: 'Lieferschein_ID', mitRabatt: false },
};

/**
 * Die Belegsummen einer Rechnung oder eines Lieferscheins, vollstaendig in SQL
 * gerechnet.
 *
 * Liefert zusaetzlich die Aufteilung je Herstellerin (Artikelnummer beginnt mit
 * M oder S), weil das Frontend sie bisher aus rohen Preisen selbst gebildet hat
 * (Befund G7).
 *
 * @param {{query: Function}} queryable db oder ein Client
 * @param {'Rechnung'|'Lieferschein'} tabelle
 * @param {number|string} belegId
 * @param {{live?: boolean}} [optionen] live: true rechnet immer aus den Live-Daten
 *   (Pflicht fuer schreibeSnapshot, sonst liest der Snapshot sich selbst)
 * @returns {Promise<Record<string, any>|null>}
 */
async function belegSummen(queryable, tabelle, belegId, { live = false } = {}) {
  const beleg = BELEGE[tabelle];
  if (!beleg) throw new Error(`Unbekannter Belegtyp: ${tabelle}`);
  const nachPosition = beleg.mitRabatt
    ? preisNachPositionsrabattSql('s', 'r')
    : 's."Verkaufspreis"';
  const rabattGesamt = beleg.mitRabatt ? 'COALESCE(r.rabatt_gesamt, 0)' : '0';
  // Versandkosten gibt es nur auf der Rechnung
  const versandkosten = beleg.mitRabatt ? 'COALESCE(r.versandkosten, 0)' : '0';
  const mitSnapshot = beleg.mitRabatt && !live;
  // snap hat genau eine Zeile, wenn die finale Rechnung eingefroren ist, sonst keine.
  // Der Prozentwert des Gesamtrabatts bleibt der gespeicherte, solange er den
  // gespeicherten Betrag reproduziert; sonst wird er aus dem Betrag zurueckgerechnet.
  const snap = mitSnapshot
    ? `SELECT COALESCE(r.summe_brutto, 0) AS summe_brutto,
              COALESCE(r.rabatt_gesamt_betrag, 0) AS rabatt_betrag,
              CASE WHEN COALESCE(r.summe_brutto, 0) <= 0 THEN COALESCE(r.rabatt_gesamt, 0)
                   WHEN round(r.summe_brutto * COALESCE(r.rabatt_gesamt, 0) / 100, 2)
                        = COALESCE(r.rabatt_gesamt_betrag, 0) THEN COALESCE(r.rabatt_gesamt, 0)
                   ELSE round(r.rabatt_gesamt_betrag / r.summe_brutto * 100, 2) END AS rabatt_prozent,
              COALESCE(r.provision_prozent, 0) AS provision_prozent,
              COALESCE(r.provision_betrag, 0) AS provision_betrag,
              COALESCE(r.versand_betrag, 0) AS versand_betrag
       FROM "Rechnung" r
       WHERE r."ID" = $1 AND ${snapshotAktivSql('r')}`
    : `SELECT NULL::numeric AS summe_brutto, NULL::numeric AS rabatt_betrag,
              NULL::numeric AS rabatt_prozent, NULL::numeric AS provision_prozent,
              NULL::numeric AS provision_betrag, NULL::numeric AS versand_betrag
       WHERE false`;
  /** @type {(spalte: string, live: string) => string} */
  const vorSnapshot = (spalte, live) => (mitSnapshot ? `COALESCE(snap.${spalte}, ${live})` : live);
  const snapshotPositionen = mitSnapshot
    ? `UNION ALL
       SELECT LEFT(p.artikelnummer_id, 1),
              round((p.einzelpreis * (1 - p.positionsrabatt / 100))::numeric, 2)
       FROM "Rechnung_Position" p
       WHERE p.rechnung_id = $1 AND EXISTS (SELECT 1 FROM snap)`
    : '';
  const { rows } = await queryable.query(
    `WITH snap AS (
       ${snap}
     ),
     positionen AS (
       SELECT
         LEFT(s."Artikelnummer", 1) AS hersteller,
         -- pro Stueck auf Cent runden, dann summieren: dieselbe Reihenfolge
         -- wie in utils/eRechnung/modell.js, sonst weichen die Belege ab
         round((${nachPosition})::numeric, 2) AS wert
       FROM "Schmuckstück" s
       JOIN "${tabelle}" r ON r."ID" = s."${beleg.fk}"
       WHERE s."${beleg.fk}" = $1 AND NOT EXISTS (SELECT 1 FROM snap)
       ${snapshotPositionen}
     ),
     kopf AS (
       -- ::numeric ist Pflicht: "Provision" ist INTEGER (Befund B8), und
       -- 40 / 100 ist in SQL Ganzzahldivision -- also 0. Ohne den Cast war der
       -- Ueberweisungsbetrag gleich der Summe vor Provision.
       SELECT ${vorSnapshot('rabatt_prozent', `${rabattGesamt}::numeric`)} AS rabatt_gesamt,
              ${vorSnapshot('provision_prozent', 'COALESCE(k."Provision", 0)::numeric')} AS provision,
              ${vorSnapshot('versand_betrag', `${versandkosten}::numeric`)} AS versandkosten
       FROM "${tabelle}" r
       LEFT JOIN "Kunde" k ON k."ID" = r."Kundennummer"
       LEFT JOIN snap ON TRUE
       WHERE r."ID" = $1
     ),
     summen AS (
       SELECT
         COALESCE(SUM(wert), 0)                                        AS gesamtwert,
         COALESCE(SUM(wert) FILTER (WHERE hersteller = 'M'), 0)        AS marina,
         COALESCE(SUM(wert) FILTER (WHERE hersteller = 'S'), 0)        AS saskia
       FROM positionen
     ),
     -- Jede Zeile wird aus der VORHERIGEN gerundeten Zeile abgeleitet, nicht
     -- unabhaengig aus dem Rohwert. Vorher war jedes Feld ein eigenes
     -- round(gesamtwert * ...), und die Teile ergaben das Ganze nicht mehr:
     -- Rechnung 273 wies 119.25 Gesamtwert, 11.93 Rabatt und 107.33 Restsumme
     -- aus -- zusammen 119.26. Ein Beleg, der sich um einen Cent selbst
     -- widerspricht, ist genau der Fehler, den Befund C17 beschreibt. Die
     -- Reihenfolge entspricht zugleich der Cent-Arithmetik der E-Rechnung
     -- (utils/eRechnung/modell.js), damit XRechnung und Excel denselben Betrag
     -- nennen.
     schritte AS (
       SELECT COALESCE(snap.summe_brutto, round(summen.gesamtwert, 2)) AS gesamtwert,
              round(summen.marina, 2)     AS marina,
              round(summen.saskia, 2)     AS saskia,
              COALESCE(snap.rabatt_betrag,
                round(round(summen.gesamtwert, 2) * kopf.rabatt_gesamt / 100, 2))
                AS gesamtrabatt_betrag,
              kopf.rabatt_gesamt,
              kopf.provision,
              kopf.versandkosten
         FROM summen CROSS JOIN kopf LEFT JOIN snap ON TRUE
     ),
     nach_rabatt AS (
       SELECT schritte.*,
              gesamtwert - gesamtrabatt_betrag              AS summe_nach_rabatt,
              round(marina * (1 - rabatt_gesamt / 100), 2)  AS marina_brutto
         FROM schritte
     ),
     nach_provision AS (
       SELECT nach_rabatt.*,
              COALESCE(snap.provision_betrag, round(summe_nach_rabatt * provision / 100, 2))
                AS provision_betrag,
              -- Der Rest geht an Saskia, damit marina_brutto + saskia_brutto
              -- immer exakt summe_nach_rabatt ergibt.
              summe_nach_rabatt - marina_brutto             AS saskia_brutto
         FROM nach_rabatt LEFT JOIN snap ON TRUE
     )
     SELECT
       gesamtwert,
       gesamtrabatt_betrag,
       summe_nach_rabatt,
       provision_betrag,
       versandkosten,
       summe_nach_rabatt - provision_betrag + versandkosten AS ueberweisungsbetrag,
       marina_brutto,
       round(marina_brutto * (1 - provision / 100), 2) AS marina_netto,
       saskia_brutto,
       (summe_nach_rabatt - provision_betrag)
         - round(marina_brutto * (1 - provision / 100), 2) AS saskia_netto,
       rabatt_gesamt,
       provision
     FROM nach_provision`,
    [belegId],
  );
  return rows[0] || null;
}

module.exports = {
  preisNachPositionsrabattSql,
  preisNachAllenRabattenSql,
  preisNachPositionsrabatt,
  belegSummen,
};
