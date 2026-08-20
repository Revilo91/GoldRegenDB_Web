// Erweitert Express' Request um `req.user`, wie es
// backend/src/middleware/auth.js nach erfolgreicher JWT-Prüfung setzt.
//
// Inhalt des Payloads: siehe jwt.sign(...) in backend/src/routes/auth.js
//   { id, username, role }  + von jsonwebtoken automatisch ergänzt: iat, exp.
// Ein einzelnes Feld (z. B. "tenant_id" in routes/dashboard.js) wird optional
// per Optional Chaining gelesen, existiert aber in keinem aktuellen
// JWT-Payload und keiner Tabelle – dort bewusst nicht mit aufgenommen.

import type { AppRole } from './db';

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: AppRole;
  /** Ausstellungszeitpunkt (Unix-Sekunden), von jsonwebtoken ergänzt. */
  iat?: number;
  /** Ablaufzeitpunkt (Unix-Sekunden), von jsonwebtoken ergänzt. */
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Gesetzt von middleware/auth.js (authenticate) nach erfolgreicher
       * JWT-Prüfung. Vor dieser Middleware bzw. auf öffentlichen Routen
       * ist das Feld nicht vorhanden – daher optional.
       */
      user?: AuthenticatedUser;
    }
  }
}

export {};
