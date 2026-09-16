'use strict';

// Standard-Mock für '../src/config/db', wie er in allen Routen-Tests via
// jest.mock('../src/config/db', () => createDbMock()) verwendet wird.
function createDbMock() {
  return {
    query: jest.fn(),
    connect: jest.fn(),
    setCurrentDbUsername: jest.fn(),
    requestContextMiddleware: (req, res, next) => next(),
  };
}

module.exports = { createDbMock };
