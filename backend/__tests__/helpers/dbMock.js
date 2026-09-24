'use strict';

// Standard-Mock für '../src/config/db', wie er in allen Routen-Tests via
// jest.mock('../src/config/db', () => createDbMock()) verwendet wird.

// Warum der Mock das SQL anschaut, statt es nur zu schlucken:
//
// In routes/inventur.js stand ein Quartal lang
//   round(SUM(CASE WHEN ... THEN 1 ELSE 0 END)::int AS "verkauft",
// -- ein verirrtes round( ohne zweites Argument und ohne schliessende
// Klammer, entstanden beim Einwickeln der GELDsummen. GET /api/inventur
// antwortete seitdem mit 500 ("syntax error at or near AS"), und keiner der
// 521 Tests hat es gesehen: der Mock gibt Zeilen zurueck, ohne dass je ein
// Parser das SQL liest. Aufgefallen ist es erst im Betrieb.
//
// Die Klammerbilanz ist billig zu pruefen und haette genau diesen Fehler
// gefunden. Sie ersetzt keinen Integrationstest, schliesst aber die Luecke
// zwischen "Mock antwortet" und "Postgres versteht es".
function pruefeKlammern(sql) {
  const text = String(sql);
  let tiefe = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") {
      // '' ist ein escaptes Quote innerhalb eines Literals
      if (inString && text[i + 1] === "'") i += 1;
      else inString = !inString;
    } else if (!inString) {
      if (c === '(') tiefe += 1;
      else if (c === ')') tiefe -= 1;
      if (tiefe < 0) {
        throw new Error(
          `SQL hat eine ueberzaehlige schliessende Klammer:\n${text}`,
        );
      }
    }
  }
  if (tiefe !== 0) {
    throw new Error(
      `SQL hat ${tiefe} nicht geschlossene Klammer(n):\n${text}`,
    );
  }
}

function createDbMock() {
  return {
    query: jest.fn(),
    pruefeKlammern,
    connect: jest.fn(),
    setCurrentDbUsername: jest.fn(),
    requestContextMiddleware: (req, res, next) => next(),
    // Startup-Teil: index.js wartet auf initializeDatabase() und der
    // Health-Endpunkt fragt isSchemaReady() ab. Im Test gilt das Schema als
    // fertig, damit Routen-Tests nicht am Startup hängen.
    initializeDatabase: jest.fn().mockResolvedValue(undefined),
    isSchemaReady: jest.fn(() => true),
    pool: { end: jest.fn().mockResolvedValue(undefined) },
  };
}

module.exports = { createDbMock, pruefeKlammern };
