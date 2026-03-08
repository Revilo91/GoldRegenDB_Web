import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, adminOnly = false, bearbeiterOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Laden…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.role !== "admin") {
    return (
      <div className="main-content">
        <div className="page-header">
          <h2>Zugriff verweigert</h2>
          <p>Diese Seite ist nur für Administratoren zugänglich.</p>
        </div>
      </div>
    );
  }

  if (bearbeiterOnly && user.role !== "admin" && user.role !== "bearbeiter") {
    return (
      <div className="main-content">
        <div className="page-header">
          <h2>Zugriff verweigert</h2>
          <p>Diese Seite erfordert Bearbeiter-Berechtigung.</p>
        </div>
      </div>
    );
  }

  return children;
}
