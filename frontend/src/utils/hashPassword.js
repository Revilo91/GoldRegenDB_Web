/**
 * Hashes a password using SHA-256 via the Web Crypto API.
 * The resulting hex string is sent to the backend instead of the plaintext password.
 * The backend then applies bcrypt on this hash for storage.
 *
 * @param {string} password - The plaintext password
 * @returns {Promise<string>} - The SHA-256 hex digest (64 characters)
 */
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
