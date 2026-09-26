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
import { statusBadge, statusVon, STATUS } from "../utils/status";
import { formatEur } from "../utils/zahlen";
import { useToast } from "./Toast";

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
  const toast = useToast();
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
      .catch((err) => {
        toast.fehler("Fehler beim Laden des Schmuckstücks: " + err.message);
        onClose();
      })
      .finally(() => setLoading(false));
  }, [artikelnummer, toast]);

  useEffect(() => {
    if (item?.hatFoto) {
      setPhotoLoading(true);
      setPhotoError(null);
      api
        .loadPhotoAsDataUrl(item.Artikelnummer)
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

  const displayName = item?.Name?.trim();

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
                {(() => {
                  // Der Status kommt aus utils/status.js; hier wird zusätzlich
                  // der Kunde gezeigt, wenn ein verkauftes Stück bei ihm liegt.
                  const badge = statusBadge(item, getKundenName);
                  const status = statusVon(item);
                  if (status === STATUS.VERKAUFT && Number(item.Ausgelagert) > 0) {
                    return (
                      <div className="badge-gruppe">
                        <span className={badge.klasse}>{badge.label}</span>
                        <span className="badge gold">
                          {getKundenName(item.Ausgelagert)}
                        </span>
                      </div>
                    );
                  }
                  return <span className={badge.klasse}>{badge.label}</span>;
                })()}
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
            {displayName && (
              <div className="schmuck-modal-name">
                <span className="schmuck-modal-name-label">Name</span>
                <div className="schmuck-modal-name-value">{displayName}</div>
              </div>
            )}

            {/* Foto */}
            <div className="schmuck-modal-photo">
              {photo ? (
                <img src={photo} alt={item.Artikelnummer} />
              ) : item.hatFoto && photoLoading ? (
                <div className="schmuck-modal-photo-placeholder loading">
                  <span>⏳</span>
                  Bild wird geladen...
                </div>
              ) : item.hatFoto && photoError ? (
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
                  item.Herstellungskosten ? formatEur(item.Herstellungskosten) : "–",
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
          </>
        ) : (
          <div className="empty-state">Schmuckstück nicht gefunden.</div>
        )}
      </div>
    </div>
  );
}
