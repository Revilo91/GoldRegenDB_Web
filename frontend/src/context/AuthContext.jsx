import { createContext, useContext, useState, useEffect } from "react";
import { authApi } from "../api";

const AuthContext = createContext(null);

const LOG_PREFIX = "[FRONTEND/AUTH]";

function logInfo(msg) {
  console.log(`${new Date().toISOString()} ${LOG_PREFIX} ${msg}`);
}

function logWarn(msg) {
  console.warn(`${new Date().toISOString()} ${LOG_PREFIX} ${msg}`);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Das JWT liegt in einem httpOnly-Cookie und ist für JavaScript unsichtbar.
  // Ob eine Sitzung besteht, lässt sich deshalb nur über /auth/me feststellen –
  // der Aufruf erfolgt bei jedem Start, nicht mehr nur bei vorhandenem Token.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logInfo("Sitzung wird geprüft...");
    authApi
      .me()
      .then(({ user: u }) => {
        logInfo(`Sitzung gültig – Benutzer: ${u.username} (Rolle: ${u.role})`);
        setUser(u);
        // mustChangePassword aus sessionStorage wiederherstellen (übersteht Reload)
        if (sessionStorage.getItem("mustChangePassword") === "true") {
          setMustChangePassword(true);
        }
      })
      .catch(() => {
        logInfo("Keine gültige Sitzung – Benutzer nicht angemeldet");
        sessionStorage.removeItem("mustChangePassword");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function login(userData, mustChange = false) {
    logInfo(
      `Login erfolgreich: ${userData.username} (Rolle: ${userData.role}), Passwort ändern: ${mustChange}`,
    );
    if (mustChange) {
      sessionStorage.setItem("mustChangePassword", "true");
    }
    setUser(userData);
    setMustChangePassword(mustChange);
  }

  function clearMustChangePassword() {
    logInfo(`Passwort-Änderungspflicht aufgehoben für: ${user?.username}`);
    setMustChangePassword(false);
    sessionStorage.removeItem("mustChangePassword");
  }

  async function logout() {
    logInfo(`Logout: ${user?.username || "unbekannt"}`);
    try {
      // Nur das Backend kann das httpOnly-Cookie löschen
      await authApi.logout();
    } catch (err) {
      logWarn(`Logout am Backend fehlgeschlagen: ${err.message}`);
    }
    sessionStorage.removeItem("mustChangePassword");
    setUser(null);
    setMustChangePassword(false);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        mustChangePassword,
        clearMustChangePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
