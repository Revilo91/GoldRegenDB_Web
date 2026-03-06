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
  // Loading is true only when a token exists in storage and needs to be validated
  const [loading, setLoading] = useState(() => !!localStorage.getItem("token"));

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      logInfo("Kein Token gespeichert – Benutzer nicht angemeldet");
      return;
    }
    logInfo("Token gefunden – Validierung wird gestartet...");
    authApi
      .me()
      .then(({ user: u }) => {
        logInfo(`Token gültig – Benutzer: ${u.username} (Rolle: ${u.role})`);
        setUser(u);
        // Restore mustChangePassword from sessionStorage (survives page reload within session)
        const storedFlag = sessionStorage.getItem("mustChangePassword");
        if (storedFlag === "true") {
          setMustChangePassword(true);
        }
      })
      .catch((err) => {
        logWarn(
          `Token-Validierung fehlgeschlagen: ${err.message} – Benutzer wird abgemeldet`,
        );
        localStorage.removeItem("token");
        sessionStorage.removeItem("mustChangePassword");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function login(token, userData, mustChange = false) {
    logInfo(
      `Login erfolgreich: ${userData.username} (Rolle: ${userData.role}), Passwort ändern: ${mustChange}`,
    );
    localStorage.setItem("token", token);
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

  function logout() {
    logInfo(`Logout: ${user?.username || "unbekannt"}`);
    localStorage.removeItem("token");
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
