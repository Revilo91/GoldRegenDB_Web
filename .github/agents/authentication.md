# Authentication & Authorization Skill

## Overview

This skill covers JWT-based authentication, password hashing, role-based access control, and rate limiting in the GoldRegenDB system.

## Role Hierarchy

| Role | Access Level | Permissions |
|------|-------------|-------------|
| `admin` | Full | Dashboard, Kunden, Schmuckstücke, Lieferscheine, Rechnungen, SumUp, Inventur + Audit-Log, Debug, Benutzerverwaltung, Datensicherung |
| `bearbeiter` | Operational | Dashboard, Kunden, Schmuckstücke, Lieferscheine, Rechnungen, SumUp, Inventur |
| `user` | Limited | Schmuckstücke creation only (POST /api/schmuckstuecke) |

## Key Files

- `/backend/src/routes/auth.js` - Authentication endpoints
- `/backend/src/routes/users.js` - User management (admin only)
- `/backend/src/middleware/auth.js` - JWT middleware
- `/frontend/src/context/AuthContext.jsx` - Frontend auth context
- `/frontend/src/utils/hashPassword.js` - Password hashing utility
- `/frontend/src/components/ProtectedRoute.jsx` - Route protection

## Authentication Flow

### 1. Password Hashing

**Frontend (before transmission):**
```javascript
// frontend/src/utils/hashPassword.js
import { hashPassword } from '../utils/hashPassword.js';

// User enters password: "mypassword"
const hashedPassword = await hashPassword("mypassword");
// Returns: 64-character hex string via SHA-256
```

**Implementation:**
- Primary: Web Crypto API (`crypto.subtle.digest`) in secure contexts (HTTPS/localhost)
- Fallback: Pure JavaScript implementation for HTTP environments
- Output: 64-character hexadecimal string

**Backend (storage):**
```javascript
// backend/src/routes/users.js
const bcrypt = require('bcryptjs');

// Frontend sends 64-char hex hash
const password_hash = await bcrypt.hash(req.body.password, 10);
// Stores bcrypt hash (10 rounds) in database
```

### 2. Login Process

**Endpoint:** `POST /api/auth/login`

```javascript
// Request
{
  "username": "admin",
  "password": "abc123..." // 64-char SHA-256 hash from frontend
}

// Response (Success)
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "email": "admin@example.com",
    "must_change_password": false
  }
}
```

**Implementation (`backend/src/routes/auth.js`):**
```javascript
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // 1. Query user from database
  const result = await db.query(
    'SELECT * FROM app_users WHERE username = $1 AND active = TRUE',
    [username]
  );

  // 2. Verify password (bcrypt comparison)
  const isValid = await bcrypt.compare(password, user.password_hash);

  // 3. Generate JWT token
  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenant_id: user.tenant_id
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  // 4. Update last_login timestamp
  // 5. Return token and user data
});
```

### 3. Token Validation

**Middleware (`backend/src/middleware/auth.js`):**

```javascript
const authenticate = async (req, res, next) => {
  try {
    // 1. Extract token from Authorization header
    const token = req.headers.authorization?.replace('Bearer ', '');

    // 2. Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Fetch fresh user data from database
    const result = await client.query(
      'SELECT id, username, role, email, tenant_id FROM app_users WHERE id = $1 AND active = TRUE',
      [decoded.userId]
    );

    // 4. Set req.user for downstream use
    req.user = result.rows[0];

    // 5. Configure database session user for audit triggers
    await client.query(
      "SELECT set_config('app.current_user', $1, false)",
      [req.user.username]
    );

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};
```

**Role-Based Middleware:**

```javascript
// Require admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Require bearbeiter or admin role
const requireBearbeiter = (req, res, next) => {
  if (!['admin', 'bearbeiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};
```

## Rate Limiting

**Configuration (`backend/src/index.js`):**

```javascript
const rateLimit = require('express-rate-limit');

// Login endpoint rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: 'Too many login attempts, please try again later'
});

app.use('/api/auth/login', loginLimiter);

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute
  message: 'Too many requests, please slow down'
});

app.use('/api/', apiLimiter);
```

## Frontend Integration

### AuthContext

**Setup (`frontend/src/context/AuthContext.jsx`):**

```javascript
import React, { createContext, useState, useEffect } from 'react';
import { login as apiLogin, getCurrentUser } from '../api';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing token on mount
    const token = localStorage.getItem('token');
    if (token) {
      getCurrentUser()
        .then(setUser)
        .catch(() => logout());
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const data = await apiLogin(username, password);
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
```

### Protected Routes

**Implementation (`frontend/src/components/ProtectedRoute.jsx`):**

```javascript
import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

export function ProtectedRoute({ children, adminOnly, bearbeiterOnly }) {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/" />;
  }

  if (bearbeiterOnly && !['admin', 'bearbeiter'].includes(user.role)) {
    return <Navigate to="/" />;
  }

  return children;
}
```

**Usage in App.jsx:**

```javascript
<Route
  path="/audit-log"
  element={
    <ProtectedRoute adminOnly>
      <AuditLog />
    </ProtectedRoute>
  }
/>

<Route
  path="/inventur"
  element={
    <ProtectedRoute bearbeiterOnly>
      <Inventur />
    </ProtectedRoute>
  }
/>
```

## API Client with Authentication

**Implementation (`frontend/src/api.js`):**

```javascript
const API_URL = import.meta.env.VITE_API_URL || '/api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };
};

export const login = async (username, password) => {
  const hashedPassword = await hashPassword(password);
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: hashedPassword })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  return response.json();
};

export const getCurrentUser = async () => {
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: getAuthHeaders()
  });

  if (!response.ok) {
    throw new Error('Session expired');
  }

  return response.json();
};
```

## User Management (Admin Only)

### List Users

**Endpoint:** `GET /api/users`

**Response:**
```json
[
  {
    "id": 1,
    "username": "admin",
    "email": "admin@example.com",
    "role": "admin",
    "active": true,
    "must_change_password": false,
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_login": "2024-01-15T10:30:00.000Z"
  }
]
```

### Create User

**Endpoint:** `POST /api/users`

**Request:**
```json
{
  "username": "newuser",
  "password": "abc123...",  // 64-char SHA-256 hash
  "email": "user@example.com",
  "role": "bearbeiter",
  "active": true
}
```

**Implementation:**
```javascript
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { username, password, email, role, active } = req.body;

  // Hash password with bcrypt
  const password_hash = await bcrypt.hash(password, 10);

  // Insert new user
  const result = await db.query(
    `INSERT INTO app_users
     (username, password_hash, email, role, active, must_change_password, tenant_id)
     VALUES ($1, $2, $3, $4, $5, FALSE, $6)
     RETURNING id, username, email, role, active, created_at`,
    [username, password_hash, email, role, active !== false, req.user.tenant_id ?? 1]
  );

  res.status(201).json(result.rows[0]);
});
```

### Change Password

**Endpoint:** `PUT /api/auth/change-password`

**Request:**
```json
{
  "currentPassword": "abc...",  // 64-char hash
  "newPassword": "def..."       // 64-char hash
}
```

**Implementation:**
```javascript
router.put('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // 1. Verify current password
  const user = await db.query(
    'SELECT password_hash FROM app_users WHERE id = $1',
    [req.user.id]
  );

  const isValid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
  if (!isValid) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  // 2. Hash and update new password
  const newHash = await bcrypt.hash(newPassword, 10);
  await db.query(
    'UPDATE app_users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
    [newHash, req.user.id]
  );

  res.json({ message: 'Password changed successfully' });
});
```

## Default Credentials

**Initial Setup:**
- Username: `admin`
- Password: `admin`
- Role: `admin`
- must_change_password: `TRUE`

**After first login, user must change password.**

## Security Best Practices

### 1. JWT Secret Management

**CRITICAL:** JWT_SECRET must be set as environment variable:

```bash
# .env
JWT_SECRET=change-this-to-a-long-random-secret-at-least-32-characters
```

**Generation:**
```bash
# Generate secure random secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Token Expiration

Default: 24 hours

To customize:
```javascript
jwt.sign(payload, secret, { expiresIn: '12h' }); // 12 hours
jwt.sign(payload, secret, { expiresIn: '7d' });  // 7 days
```

### 3. HTTPS in Production

- Frontend password hashing uses Web Crypto API in HTTPS contexts
- Falls back to JS implementation for HTTP (development only)
- **Always use HTTPS in production**

### 4. Password Requirements

**Current:** No complexity requirements (to be implemented)

**Recommended:**
- Minimum 8 characters
- Mix of uppercase, lowercase, numbers, special characters
- Check against common password lists

### 5. Audit Trail

The `authenticate` middleware sets the database session user:
```javascript
await client.query(
  "SELECT set_config('app.current_user', $1, false)",
  [req.user.username]
);
```

This allows database triggers to capture `changed_by` in the audit log.

## Common Patterns

### Protecting Backend Routes

```javascript
const { authenticate, requireAdmin, requireBearbeiter } = require('../middleware/auth');

// Public route
router.get('/health', (req, res) => { /* ... */ });

// Authenticated only
router.get('/dashboard', authenticate, (req, res) => { /* ... */ });

// Bearbeiter or admin
router.get('/kunden', authenticate, requireBearbeiter, (req, res) => { /* ... */ });

// Admin only
router.get('/audit-log', authenticate, requireAdmin, (req, res) => { /* ... */ });
```

### Accessing User Information in Routes

```javascript
router.get('/profile', authenticate, async (req, res) => {
  // req.user is set by authenticate middleware
  const { id, username, role, email, tenant_id } = req.user;

  // Use tenant_id for multi-tenant queries
  const results = await db.query(
    'SELECT * FROM "Kunde" WHERE tenant_id = $1',
    [tenant_id ?? 1]
  );

  res.json(results.rows);
});
```

### Frontend Role-Based UI

```javascript
import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

function Navigation() {
  const { user } = useContext(AuthContext);

  return (
    <nav>
      <Link to="/">Dashboard</Link>
      <Link to="/schmuckstuecke">Schmuckstücke</Link>

      {/* Bearbeiter and Admin */}
      {['admin', 'bearbeiter'].includes(user?.role) && (
        <>
          <Link to="/kunden">Kunden</Link>
          <Link to="/lieferscheine">Lieferscheine</Link>
          <Link to="/rechnungen">Rechnungen</Link>
        </>
      )}

      {/* Admin only */}
      {user?.role === 'admin' && (
        <>
          <Link to="/audit-log">Audit Log</Link>
          <Link to="/users">Benutzerverwaltung</Link>
          <Link to="/backup">Datensicherung</Link>
        </>
      )}
    </nav>
  );
}
```

## Testing

### Mock JWT Middleware

```javascript
// backend/__tests__/auth.middleware.test.js
jest.mock('../src/config/db');
jest.mock('../src/utils/logger');

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
});

test('authenticate middleware validates token', async () => {
  const token = jwt.sign(
    { userId: 1, username: 'testuser', role: 'admin' },
    process.env.JWT_SECRET
  );

  const req = {
    headers: { authorization: `Bearer ${token}` }
  };

  await authenticate(req, res, next);

  expect(req.user).toBeDefined();
  expect(req.user.username).toBe('testuser');
});
```

### Mock Protected Routes

```javascript
// backend/__tests__/schmuckstuecke.routes.test.js
beforeEach(() => {
  // Mock authenticate middleware
  require('../src/middleware/auth').authenticate = (req, res, next) => {
    req.user = { id: 1, username: 'test', role: 'bearbeiter', tenant_id: 1 };
    next();
  };
});
```

## Related Skills

- [Database Operations](./database-operations.md) - Session user configuration
- [Audit & Compliance](./audit-compliance.md) - User attribution in audit logs
- [Testing & Quality](./testing.md) - Testing authentication flows

## Troubleshooting

### "Unauthorized" Error

**Cause:** Invalid or expired token
**Solution:**
1. Check token in localStorage
2. Verify JWT_SECRET matches between sign and verify
3. Check token expiration
4. Re-login to get fresh token

### "Insufficient permissions" Error

**Cause:** User role doesn't have access
**Solution:**
1. Verify user role in database
2. Check requireAdmin/requireBearbeiter middleware
3. Update user role if needed (admin only)

### Password Hash Mismatch

**Cause:** Frontend not sending SHA-256 hash
**Solution:**
1. Ensure `hashPassword()` is called before sending
2. Verify 64-character hex string is transmitted
3. Check bcrypt.compare() call in backend

### Rate Limit Exceeded

**Cause:** Too many requests
**Solution:**
1. Wait for rate limit window to expire
2. Adjust rate limits in production if legitimate traffic
3. Implement exponential backoff in client
