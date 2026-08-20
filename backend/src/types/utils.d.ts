// Rückgabeformen zentraler, sicherheitsrelevanter Utils, die (noch) nicht
// selbst unter @ts-check stehen. Diese Typen sind rein dokumentativ – sie
// werden nirgends automatisch gegen die .js-Implementierung geprüft, sollten
// bei Änderung an der jeweiligen Datei also mitgepflegt werden.
//
// Reihenfolge/Inhalt folgt den Original-Dateien in backend/src/utils/.

import type { AppRole, AppUserRow } from './db';

// ── passwordService.js ───────────────────────────────────────────────────────

export interface PasswortPruefErgebnis {
  valid: boolean;
  /**
   * true, wenn der Treffer nur über das alte bcrypt(sha256(...))-Schema
   * zustande kam (siehe Issue #131) – der Aufrufer soll den Hash dann auf
   * bcrypt(klartext) umstellen.
   */
  needsRehash: boolean;
}

// ── accountSecurity.js ───────────────────────────────────────────────────────

// Minimaler Ausschnitt aus AppUserRow, den die Lockout-/Reset-Helfer brauchen.
export type SperrbarerUser = Pick<AppUserRow, 'failed_login_attempts' | 'locked_until'>;

export interface FehlversuchErgebnis {
  /** Neuer Zähler nach diesem Fehlversuch. */
  versuche: number;
  /** Gesetzt, sobald MAX_FEHLVERSUCHE erreicht ist – sonst null. */
  lockedUntil: Date | null;
}

export interface ResetTokenErgebnis {
  /** Klartext-Token, das per Reset-Link an den Benutzer geht. */
  token: string;
  /** SHA-256-Hash von `token` – nur dieser wird in app_users gespeichert. */
  tokenHash: string;
  expiry: Date;
}

// ── whereClauseBuilder.js ────────────────────────────────────────────────────
// Vollständige Signatur steht als JSDoc direkt in whereClauseBuilder.js
// (@ts-check-Pilot), hier nur der Rückgabewert von build()/getParams() für
// Aufrufer, die die Builder-Klasse nicht selbst importieren.

export interface WhereClauseResult {
  /** z. B. `WHERE "Verkauft" = 0 AND "Ausschuss" = 0` oder `""` ohne Bedingungen. */
  sql: string;
  params: unknown[];
}

// ── auth.js (middleware) ─────────────────────────────────────────────────────

export interface JwtPayload {
  id: number;
  username: string;
  role: AppRole;
  iat?: number;
  exp?: number;
}
