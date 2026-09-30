// Geteilte Rückgabeformen von passwordService.js und accountSecurity.js. Beide
// Dateien stehen unter @ts-check und referenzieren diese Typen per JSDoc, tsc
// prüft die Implementierung also gegen sie. Nur Typen, die von mindestens einer
// Datei importiert werden, gehören hierher.

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
