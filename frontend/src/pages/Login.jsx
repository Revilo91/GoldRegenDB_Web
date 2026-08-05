import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetHinweis, setResetHinweis] = useState(null);

  async function handleForgotPassword() {
    setError(null);
    setResetHinweis(null);
    if (!username.trim()) {
      setError("Bitte zuerst den Benutzernamen eingeben.");
      return;
    }
    try {
      const { message } = await authApi.forgotPassword(username);
      setResetHinweis(message);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user, mustChangePassword } = await authApi.login(
        username,
        password,
      );
      login(token, user, mustChangePassword);
      navigate("/");
    } catch (err) {
      const status = err.status || err.response?.status || "Unbekannt";
      const resData = err.response?.data;
      const details =
        resData?.detail ||
        resData?.description ||
        (resData?.errors ? JSON.stringify(resData.errors) : null) ||
        err.message;

      setError(`[Status ${status}] – ${details}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/Logo transparent.png" alt="GoldRegen" />
        </div>
        <h2 className="login-title">Anmelden</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Benutzername</label>
            <input
              id="username"
              className="form-control"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              className="form-control"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          {resetHinweis && <p className="login-success">{resetHinweis}</p>}
          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}>
            {loading ? "Wird angemeldet…" : "Anmelden"}
          </button>
        </form>
        <button
          type="button"
          className="login-link"
          onClick={handleForgotPassword}>
          Passwort vergessen?
        </button>
      </div>
    </div>
  );
}
