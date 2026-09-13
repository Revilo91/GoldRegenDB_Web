const logger = require('../utils/logger');

// Übersetzt einen Zod-Fehler in eine einzelne, für den Benutzer lesbare Meldung.
function formatIssue(issue) {
  const pfad = issue.path.length > 0 ? issue.path.join('.') : 'Anfrage';
  return `${pfad}: ${issue.message}`;
}

// Prüft req[source] gegen ein Zod-Schema und ersetzt es durch die geparsten Daten.
// Unbekannte Felder entfernt Zod dabei automatisch, sodass nur explizit
// erlaubte Werte in die SQL-Statements gelangen.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const meldung = formatIssue(result.error.issues[0]);
      logger.warn('VALIDATION', `${req.method} ${req.originalUrl} abgelehnt`, {
        reason: meldung,
        anzahlFehler: result.error.issues.length,
      });
      return res.status(400).json({
        error: meldung,
        details: result.error.issues.map(formatIssue),
      });
    }
    // req.query und req.params sind in Express 5 Getter ohne Setter
    if (source === 'body') {
      req.body = result.data;
    } else {
      req[`validated${source[0].toUpperCase()}${source.slice(1)}`] = result.data;
    }
    return next();
  };
}

module.exports = { validate };
