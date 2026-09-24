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
//   Ueberweisungsbetrag = Summe nach Rabatt - Provision
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

/**
 * SQL-Ausdruck fuer den Einzelpreis nach Positions- UND Gesamtrabatt.
 * Mathematisch ist SUMME(p) * (1-g) gleich SUMME(p * (1-g)), der Faktor darf
 * also je Zeile stehen -- das erlaubt die Verwendung in FILTER und GROUP BY.
 *
 * @param {string} [s='s']
 * @param {string} [r='r']
 * @returns {string}
 */
function preisNachAllenRabattenSql(s = 's', r = 'r') {
  return `(${preisNachPositionsrabattSql(s, r)})`
    + ` * (1 - COALESCE(${r}.rabatt_gesamt, 0) / 100)`;
}

/**
 * Einzelpreis nach Positionsrabatt in JavaScript, auf Cent gerundet.
 * Fuer die Positionszeilen des Belegs -- die Summen kommen aus SQL.
 *
 * @param {string|number} preis
 * @param {string|number} rabattProzent
 * @returns {number}
 */
function preisNachPositionsrabatt(preis, rabattProzent) {
  const p = Number(preis) || 0;
  const rabatt = Number(rabattProzent) || 0;
  if (rabatt <= 0) return p;
  return Math.round(p * (1 - rabatt / 100) * 100) / 100;
}

/**
 * Die Belegsummen einer Rechnung, vollstaendig in SQL gerechnet.
 *
 * Liefert zusaetzlich die Aufteilung je Herstellerin (Artikelnummer beginnt mit
 * M oder S), weil das Frontend sie bisher aus rohen Preisen selbst gebildet hat
 * (Befund G7).
 *
 * @param {{query: Function}} queryable db oder ein Client
 * @param {number|string} rechnungId
 * @returns {Promise<object|null>}
 */
async function rechnungsSummen(queryable, rechnungId) {
  const nachPosition = preisNachPositionsrabattSql('s', 'r');
  const { rows } = await queryable.query(
    `WITH positionen AS (
       SELECT
         LEFT(s."Artikelnummer", 1) AS hersteller,
         -- pro Stueck auf Cent runden, dann summieren: dieselbe Reihenfolge
         -- wie in utils/eRechnung/modell.js, sonst weichen die Belege ab
         round((${nachPosition})::numeric, 2) AS wert
       FROM "Schmuckstück" s
       JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
       WHERE s."Rechnung_ID" = $1
     ),
     kopf AS (
       -- ::numeric ist Pflicht: "Provision" ist INTEGER (Befund B8), und
       -- 40 / 100 ist in SQL Ganzzahldivision -- also 0. Ohne den Cast war der
       -- Ueberweisungsbetrag gleich der Summe vor Provision.
       SELECT COALESCE(r.rabatt_gesamt, 0)::numeric AS rabatt_gesamt,
              COALESCE(k."Provision", 0)::numeric   AS provision
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON k."ID" = r."Kundennummer"
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
       SELECT round(summen.gesamtwert, 2) AS gesamtwert,
              round(summen.marina, 2)     AS marina,
              round(summen.saskia, 2)     AS saskia,
              round(round(summen.gesamtwert, 2) * kopf.rabatt_gesamt / 100, 2)
                AS gesamtrabatt_betrag,
              kopf.rabatt_gesamt,
              kopf.provision
         FROM summen CROSS JOIN kopf
     ),
     nach_rabatt AS (
       SELECT schritte.*,
              gesamtwert - gesamtrabatt_betrag              AS summe_nach_rabatt,
              round(marina * (1 - rabatt_gesamt / 100), 2)  AS marina_brutto
         FROM schritte
     ),
     nach_provision AS (
       SELECT nach_rabatt.*,
              round(summe_nach_rabatt * provision / 100, 2) AS provision_betrag,
              -- Der Rest geht an Saskia, damit marina_brutto + saskia_brutto
              -- immer exakt summe_nach_rabatt ergibt.
              summe_nach_rabatt - marina_brutto             AS saskia_brutto
         FROM nach_rabatt
     )
     SELECT
       gesamtwert,
       gesamtrabatt_betrag,
       summe_nach_rabatt,
       provision_betrag,
       summe_nach_rabatt - provision_betrag AS ueberweisungsbetrag,
       marina_brutto,
       round(marina_brutto * (1 - provision / 100), 2) AS marina_netto,
       saskia_brutto,
       (summe_nach_rabatt - provision_betrag)
         - round(marina_brutto * (1 - provision / 100), 2) AS saskia_netto,
       rabatt_gesamt,
       provision
     FROM nach_provision`,
    [rechnungId],
  );
  return rows[0] || null;
}

module.exports = {
  preisNachPositionsrabattSql,
  preisNachAllenRabattenSql,
  preisNachPositionsrabatt,
  rechnungsSummen,
};
