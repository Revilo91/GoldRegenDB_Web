import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGem,
  faCopy,
  faPen,
  faTrash,
  faArrowLeft,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import { useFoto } from "../hooks/useFoto";
import { useAuth } from "../context/AuthContext";
import { statusBadge } from "../utils/status";
import { formatEur } from "../utils/zahlen";
import { useToast } from "../components/Toast";

export default function SchmuckstueckDetail() {
  const toast = useToast();
  const { artikelnummer } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Edit/Delete nur wenn man von der Schmuckstücke-Liste kommt
  const fromSchmuckstuecke = location.state?.fromSchmuckstuecke === true;
  const canEdit =
    fromSchmuckstuecke &&
    user &&
    (user.role === "admin" || user.role === "bearbeiter");

  const [item, setItem] = useState(null);
  // Artikelnummer, zu der zuletzt fertig geladen wurde; "lädt" wird daraus
  // abgeleitet, statt im Effekt synchron gesetzt zu werden
  const [geladenFuer, setGeladenFuer] = useState(null);
  const loading = geladenFuer !== artikelnummer;
  const [kunden, setKunden] = useState([]);

  useEffect(() => {
    api
      .getSchmuckstueck(artikelnummer)
      .then(setItem)
      .catch(() => navigate("/schmuckstuecke", { replace: true }))
      .finally(() => setGeladenFuer(artikelnummer));
    api
      .getKunden()
      .then(setKunden)
      .catch((err) =>
        toast.fehler("Fehler beim Laden der Kunden: " + err.message),
      );
  }, [artikelnummer, toast]);

  // version: item, damit ein neu geladenes Stück auch das Foto neu holt
  const foto = useFoto(item?.hatFoto ? item.Artikelnummer : null, { version: item });

  const getKundenName = (id) => {
    const kunde = kunden.find((k) => k.ID === id);
    return kunde ? kunde.Name : `Kundennummer ${id}`;
  };

  const handleDelete = async () => {
    if (!confirm(`Schmuckstück ${artikelnummer} wirklich löschen?`)) return;
    try {
      await api.deleteSchmuckstueck(artikelnummer);
      navigate("/schmuckstuecke");
    } catch (err) {
      toast.fehler(err.message);
    }
  };

  const handleEdit = () => {
    navigate("/schmuckstuecke", { state: { openEdit: artikelnummer } });
  };

  const handleDuplicate = () => {
    navigate("/schmuckstuecke", { state: { openDuplicate: artikelnummer } });
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>Lade...
      </div>
    );
  }

  if (!item) return null;

  return (
    <div>
      <div className="page-header">
        <div className="schmuckstueck-detail-flex-ai-center-gap-12">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(-1)}
            title="Zurück">
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <div>
            <h2>
              <FontAwesomeIcon icon={faGem} /> {item.Artikelnummer}
            </h2>
            <p>
              {(() => {
                const badge = statusBadge(item, getKundenName);
                return <span className={badge.klasse}>{badge.label}</span>;
              })()}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="schmuckstueck-detail-flex-gap-8">
            <button
              className="btn btn-secondary"
              onClick={handleDuplicate}>
              <FontAwesomeIcon icon={faCopy} /> Duplizieren
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleEdit}>
              <FontAwesomeIcon icon={faPen} /> Bearbeiten
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}>
              <FontAwesomeIcon icon={faTrash} /> Löschen
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-body">
          {/* Foto */}
          <div className="schmuckstueck-detail-foto-box">
            {foto.src ? (
              <img
                src={foto.src}
                alt={item.Artikelnummer} className="schmuckstueck-detail-maxw-200-max-height-200-border-radius-8"/>
            ) : item.hatFoto && foto.laedt ? (
              <div className="schmuckstueck-detail-foto-laedt">
                <div>
                  <div className="schmuckstueck-detail-mb-8">⏳</div>
                  Bild wird geladen...
                </div>
              </div>
            ) : item.hatFoto && foto.fehler ? (
              <div className="schmuckstueck-detail-foto-fehler">
                <div>
                  <div className="schmuckstueck-detail-mb-8">⚠️</div>
                  Bild konnte nicht geladen werden
                  <div className="schmuckstueck-detail-mt-8-fs-12">
                    {foto.fehler}
                  </div>
                </div>
              </div>
            ) : (
              <div className="schmuckstueck-detail-foto-leer">
                <div>
                  <div className="schmuckstueck-detail-mb-8-fs-24">
                    📷
                  </div>
                  Kein Bild vorhanden
                </div>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="detail-grid">
            {[
              ["Grundmaterial", item.Grundmaterial],
              ["Art", item.Art],
              ["Form", item.Form],
              ["Länge", item["Länge"] ? `${item["Länge"]} cm` : "–"],
              ["Fassung", item.Fassung],
              ["Farbe", item.Farbe],
              ["Material", item.Material],
              ["Größe", item["Grösse"]],
              ["Inhalt Material", item.Inhalt_Material],
              ["Inhalt Farbe", item.Inhalt_Farbe],
              ["Inhalt Farbakzent", item.Inhalt_Farbakzent],
              ["Inhalt Zusatzmaterial", item.Inhalt_Zusatzmaterial],
              ["Anhänger Fassung", item["Anhänger_Fassung"]],
              ["Anhänger Form", item["Anhänger_Form"]],
              ["Anhänger Farbe", item["Anhänger_Farbe"]],
              ["Anhänger Größe", item["Anhänger_Grösse"]],
              ["Anhänger Inhalt Material", item["Anhänger_Inhalt_Material"]],
              ["Anhänger Inhalt Farbe", item["Anhänger_Inhalt_Farbe"]],
              ["Zwischenstück", item["Zwischenstück"]],
              [
                "Herstellungskosten",
                item.Herstellungskosten
                  ? formatEur(item.Herstellungskosten)
                  : "–",
              ],
              [
                "Verkaufspreis",
                item.Verkaufspreis ? formatEur(item.Verkaufspreis) : "–",
              ],
              [
                "Erstellt",
                item.Erstelldatum
                  ? new Date(item.Erstelldatum).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                  : "–",
              ],
              [
                "Letzte Änderung",
                item["Letzte_Änderung"]
                  ? new Date(item["Letzte_Änderung"]).toLocaleString("de-DE")
                  : "–",
              ],
            ]
              .filter(([, v]) => v && v !== "–" && v !== 0 && v !== "0")
              .map(([label, value]) => (
                <div className="detail-item" key={label}>
                  <label>{label}</label>
                  <div className="detail-value">{value}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
