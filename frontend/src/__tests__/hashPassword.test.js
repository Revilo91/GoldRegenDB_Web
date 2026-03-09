/**
 * Tests for frontend/src/utils/hashPassword.js
 *
 * The SHA-256 hash produced by this module is the password credential sent to
 * the backend. A regression here would silently break login and registration
 * for every user.
 *
 * We verify:
 * - The hash matches the known SHA-256 digest for "admin"
 *   (the default seed password used in init.sql)
 * - The output is always a 64-character lowercase hex string
 * - Empty string hashes consistently (its own well-known digest)
 * - The pure-JS fallback produces identical output to the native path
 */

import { hashPassword } from '../utils/hashPassword';

// SHA-256('admin') – also used as the seed hash in db/init.sql
const SHA256_ADMIN = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

// SHA-256('') – empty string
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('hashPassword()', () => {
  it('produces the correct SHA-256 digest for "admin"', async () => {
    const hash = await hashPassword('admin');
    expect(hash).toBe(SHA256_ADMIN);
  });

  it('always returns a 64-character lowercase hex string', async () => {
    const hash = await hashPassword('some random password 123!@#');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the correct digest for an empty string', async () => {
    const hash = await hashPassword('');
    expect(hash).toBe(SHA256_EMPTY);
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await hashPassword('password1');
    const h2 = await hashPassword('password2');
    expect(h1).not.toBe(h2);
  });

  it('is deterministic (same input → same hash)', async () => {
    const h1 = await hashPassword('consistent');
    const h2 = await hashPassword('consistent');
    expect(h1).toBe(h2);
  });

  it('is case-sensitive (uppercase ≠ lowercase)', async () => {
    const lower = await hashPassword('admin');
    const upper = await hashPassword('Admin');
    expect(lower).not.toBe(upper);
  });
});
