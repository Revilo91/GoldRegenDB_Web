'use strict';

// Standard-Mock für '../src/config/db', wie er in allen Routen-Tests via
// jest.mock('../src/config/db', () => createDbMock()) verwendet wird.
function createDbMock() {
  return {
    query: jest.fn(),
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

module.exports = { createDbMock };
