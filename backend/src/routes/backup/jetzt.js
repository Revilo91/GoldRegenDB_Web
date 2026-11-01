const router = require("express").Router();
const { sqlSicherung } = require("../../services/sqlSicherung");

/**
 * @swagger
 * /backup/jetzt:
 *   post:
 *     summary: Datenbank-Dump im Hintergrund starten ("Jetzt sichern")
 *     description: 'Startet pg_dump (Custom-Format, inklusive Fotos) in eine Datei unter
 *       MANUAL_BACKUP_DIR (Standard /backups/manual); die letzten 3 fertigen Dumps bleiben, höchstens 30 Tage.
 *       Die Antwort kommt sofort, den Fortschritt liefert GET /backup/jetzt/status.
 *       Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     responses:
 *       202:
 *         description: Sicherung gestartet
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: Es läuft bereits eine Sicherung
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post("/jetzt", (_req, res) => {
  const { gestartet, stand } = sqlSicherung().starte();
  if (!gestartet) {
    return res.status(409).json({ error: "Es läuft bereits eine Sicherung", sicherung: stand });
  }
  res.status(202).json({ sicherung: stand });
});

/**
 * @swagger
 * /backup/jetzt/status:
 *   get:
 *     summary: Stand der manuellen Sicherung
 *     description: 'status ist idle (seit Serverstart keine Sicherung), running, completed
 *       oder failed. Dazu gestartetAm, beendetAm, datei (nur Dateiname), groesse in Bytes und
 *       fehler (ohne Pfade und Zugangsdaten). Der Stand liegt im Speicher und ist nach einem
 *       Neustart idle. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     responses:
 *       200:
 *         description: Stand der Sicherung
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/jetzt/status", (_req, res) => {
  res.json({ sicherung: sqlSicherung().status() });
});

module.exports = router;
