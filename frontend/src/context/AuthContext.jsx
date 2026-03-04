import { createContext, useContext, useState, useEffect } from "react";
import { authApi } from "../api";

const AuthContext = createContext(null);

const LOG_PREFIX = '[FRONTEND/AUTH]';

function logInfo(msg) {
  console.log(`${new Date().toISOString()} ${LOG_PREFIX} ${msg}`);
}

function logWarn(msg) {
  console.warn(`${new Date().toISOString()} ${LOG_PREFIX} ${msg}`);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Loading is true only when a token exists in storage and needs to be validated
  const [loading, setLoading] = useState(() => !!localStorage.getItem("token"));

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      logInfo('Kein Token gespeichert – Benutzer nicht angemeldet');
      return;
    }
    logInfo('Token gefunden – Validierung wird gestartet...');
    authApi
      .me()
      .then(({ user: u }) => {
        logInfo(`Token gültig – Benutzer: ${u.username} (Rolle: ${u.role})`);
        setUser(u);
      })
      .catch((err) => {
        logWarn(`Token-Validierung fehlgeschlagen: ${err.message} – Benutzer wird abgemeldet`);
        localStorage.removeItem("token");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function login(token, userData) {
    logInfo(`Login erfolgreich: ${userData.username} (Rolle: ${userData.role})`);
    localStorage.setItem("token", token);
    setUser(userData);
  }

  function logout() {
    logInfo(`Logout: ${user?.username || 'unbekannt'}`);
    localStorage.removeItem("token");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
