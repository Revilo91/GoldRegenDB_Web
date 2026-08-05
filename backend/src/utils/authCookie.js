// Name des Cookies, in dem das JWT liegt.
const AUTH_COOKIE_NAME = 'jwt';

// Muss zur JWT-Laufzeit in routes/auth.js passen.
const AUTH_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

// secure=true weist den Browser an, das Cookie nur über HTTPS zu senden.
// Das Deployment läuft derzeit ohne TLS (Issue #138) – wäre die Option dort
// gesetzt, würde der Browser das Cookie verwerfen und niemand käme mehr rein.
// Nach der TLS-Umstellung COOKIE_SECURE=true setzen.
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    // 'lax' blockt das Cookie bei site-fremden POST-Requests (CSRF-Grundschutz),
    // erlaubt aber normale Navigation. Dev (5173 → 3001) ist same-site.
    sameSite: 'lax',
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

function clearAuthCookie(res) {
  // Beim Löschen dürfen maxAge/expires nicht gesetzt sein, die übrigen
  // Attribute müssen exakt denen beim Setzen entsprechen.
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}

module.exports = {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_MS,
  cookieOptions,
  setAuthCookie,
  clearAuthCookie,
};
