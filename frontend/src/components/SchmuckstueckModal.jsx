import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGem,
  faTimes,
  faCopy,
  faPen,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

/**
 * Zeigt ein Schmuckstück-Detail-Modal über einem bestehenden Modal.
 * Props:
 *   artikelnummer  – Artikelnummer des anzuzeigenden Stücks
 *   onClose        – Callback zum Schließen
 *   onDuplicate    – (optional) Callback für Duplizieren-Button
 *   onEdit         – (optional) Callback für Bearbeiten-Button
 *   onDelete       – (optional) Callback für Löschen-Button
 */
export default function SchmuckstueckModal({
  artikelnummer,
  onClose,
  onDuplicate,
  onEdit,
  onDelete,
}) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kunden, setKunden] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getSchmuckstueck(artikelnummer), api.getKunden()])
      .then(([s, k]) => {
        setItem(s);
        setKunden(k);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [artikelnummer]);

  useEffect(() => {
    if (item?.Foto) {
      setPhotoLoading(true);
      setPhotoError(null);
      api
        .loadPhotoAsDataUrl(item.Foto)
        .then(setPhoto)
        .catch((err) => {
          setPhoto(null);
          setPhotoError(err.message);
          console.error(err);
        })
        .finally(() => setPhotoLoading(false));
    } else {
      setPhoto(null);
      setPhotoError(null);
    }
  }, [item]);

  const getKundenName = (id) => {
    const kunde = kunden.find((k) => k.ID === id);
    return kunde ? kunde.Name : `Kundennummer ${id}`;
  };

  return (
    <div className="modal-overlay schmuck-modal-overlay-top">
      <div className="modal schmuck-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <h3>
              <FontAwesomeIcon icon={faGem} />{" "}
              {item ? item.Artikelnummer : artikelnummer}
            </h3>
            {item && (
              <div className="modal-header-badge">
                {item.Verkauft === 1 ? (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <span className="badge success">Verkauft</span>
                    <span className="badge gold">
                      {getKundenName(item.Ausgelagert)}
                    </span>
                  </div>
                ) : item.Ausschuss === 1 ? (
                  <span className="badge danger">Ausschuss</span>
                ) : item.Ausgelagert > 0 ? (
                  <span className="badge gold">
                    {getKundenName(item.Ausgelagert)}
                  </span>
                ) : (
                  <span className="badge warning">Lager</span>
                )}
              </div>
            )}
          </div>
          {(onDuplicate || onEdit || onDelete) && (
            <div className="modal-header-actions">
              {onDuplicate && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onDuplicate(item)}
                  disabled={!item}>
                  <FontAwesomeIcon icon={faCopy} /> Duplizieren
                </button>
              )}
              {onEdit && (
                <button className="btn btn-secondary btn-sm" onClick={onEdit}>
                  <FontAwesomeIcon icon={faPen} /> Bearbeiten
                </button>
              )}
              {onDelete && (
                <button className="btn btn-danger btn-sm" onClick={onDelete}>
                  <FontAwesomeIcon icon={faTrash} /> Löschen
                </button>
              )}
            </div>
          )}
          <button className="modal-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {loading ? (
          <div className="loading">
            <div className="spinner"></div>Lade…
          </div>
        ) : item ? (
          <>
            {/* Foto */}
            <div className="schmuck-modal-photo">
              {photo ? (
                <img src={photo} alt={item.Artikelnummer} />
              ) : item.Foto && photoLoading ? (
                <div className="schmuck-modal-photo-placeholder loading">
                  <span>⏳</span>
                  Bild wird geladen...
                </div>
              ) : item.Foto && photoError ? (
                <div className="schmuck-modal-photo-placeholder empty">
                  <span className="photo-icon">⚠️</span>
                  Bild konnte nicht geladen werden
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "#666" }}>
                    {photoError}
                  </div>
                </div>
              ) : (
                <div className="schmuck-modal-photo-placeholder empty">
                  <span className="photo-icon">📷</span>
                  Kein Bild vorhanden
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
                  item.Herstellungskosten ? `${item.Herstellungskosten}€` : "–",
                ],
                [
                  "Verkaufspreis",
                  item.Verkaufspreis ? `${item.Verkaufspreis}€` : "–",
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
          </>
        ) : (
          <div className="empty-state">Schmuckstück nicht gefunden.</div>
        )}
      </div>
    </div>
  );
}
