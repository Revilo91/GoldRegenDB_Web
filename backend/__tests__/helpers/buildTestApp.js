'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');

// Baut eine minimale Express-App für Routen-Tests: JSON-Body-Parsing,
// optional Cookie-Parsing und ein injizierbarer req.user, bevor der
// übergebene Router eingehängt wird.
function buildTestApp({ router, mountPath, user, withCookies = false }) {
  const app = express();
  app.use(express.json());
  if (withCookies) {
    app.use(cookieParser());
  }
  if (user) {
    app.use((req, res, next) => {
      req.user = user;
      next();
    });
  }
  app.use(mountPath, router);
  return app;
}

module.exports = { buildTestApp };
