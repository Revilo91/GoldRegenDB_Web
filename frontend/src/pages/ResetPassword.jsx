import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { authApi } from "../api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein");
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess("Passwort erfolgreich geändert. Sie können sich jetzt anmelden.");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h2 className="login-title">Passwort zurücksetzen</h2>
          <p className="login-error">
            Der Link ist unvollständig – es fehlt das Reset-Token.
          </p>
          <Link to="/login" className="btn btn-primary login-btn">
            Zur Anmeldung
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/Logo transparent.png" alt="GoldRegen" />
        </div>
        <h2 className="login-title">Neues Passwort festlegen</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="newPassword">Neues Passwort</label>
            <input
              id="newPassword"
              className="form-control"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirmPassword">Passwort bestätigen</label>
            <input
              id="confirmPassword"
              className="form-control"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          {success && <p className="login-success">{success}</p>}
          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading || !!success}>
            {loading ? "Wird gespeichert…" : "Passwort speichern"}
          </button>
        </form>
        <Link to="/login" className="login-link">
          Zurück zur Anmeldung
        </Link>
      </div>
    </div>
  );
}
