/**
 * Hashes a password using SHA-256.
 * Uses the Web Crypto API when available (secure contexts: HTTPS / localhost),
 * falls back to a pure-JS implementation for non-secure contexts (e.g. HTTP
 * on Synology NAS).
 *
 * The resulting hex string is sent to the backend instead of the plaintext password.
 * The backend then applies bcrypt on this SHA-256 hash for secure storage and comparison.
 *
 * @param {string} password - The plaintext password
 * @returns {Promise<string>} - The SHA-256 hex digest (64 characters)
 */
export async function hashPassword(password) {
  // Prefer native Web Crypto API (available in secure contexts)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback: pure-JS SHA-256 for non-secure contexts (HTTP)
  return sha256Fallback(password);
}

/* ─── Pure-JS SHA-256 fallback ───────────────────────────────────────────── */

function sha256Fallback(message) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotr(n, x) {
    return (x >>> n) | (x << (32 - n));
  }
  function ch(x, y, z) {
    return (x & y) ^ (~x & z);
  }
  function maj(x, y, z) {
    return (x & y) ^ (x & z) ^ (y & z);
  }
  function sigma0(x) {
    return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
  }
  function sigma1(x) {
    return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
  }
  function gamma0(x) {
    return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
  }
  function gamma1(x) {
    return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
  }

  // Encode message as UTF-8 bytes
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(message);
  const msgLen = msgBytes.length;

  // Pre-processing: add padding
  const bitLen = msgLen * 8;
  // Message needs to be padded to 64-byte (512-bit) blocks
  const totalLen = msgLen + 1 + 8; // +1 for 0x80, +8 for length
  const paddedLen = Math.ceil(totalLen / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(msgBytes);
  padded[msgLen] = 0x80;
  // Append bit length as big-endian 64-bit
  const view = new DataView(padded.buffer);
  // JavaScript bitwise ops are 32-bit, so we split
  view.setUint32(paddedLen - 8, 0, false); // high 32 bits (0 for messages < 2^32 bits)
  view.setUint32(paddedLen - 4, bitLen, false); // low 32 bits

  // Initial hash values
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  // Process each 64-byte block
  for (let offset = 0; offset < paddedLen; offset += 64) {
    const W = new Array(64);
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(offset + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      W[t] = (gamma1(W[t - 2]) + W[t - 7] + gamma0(W[t - 15]) + W[t - 16]) | 0;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;

    for (let t = 0; t < 64; t++) {
      const T1 = (h + sigma1(e) + ch(e, f, g) + K[t] + W[t]) | 0;
      const T2 = (sigma0(a) + maj(a, b, c)) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) | 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  // Convert to hex
  function toHex(n) {
    return (n >>> 0).toString(16).padStart(8, "0");
  }
  return (
    toHex(h0) +
    toHex(h1) +
    toHex(h2) +
    toHex(h3) +
    toHex(h4) +
    toHex(h5) +
    toHex(h6) +
    toHex(h7)
  );
}
