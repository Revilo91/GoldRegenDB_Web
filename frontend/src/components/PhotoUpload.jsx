import { useState, useEffect, useId } from "react";
import { api } from "../api";

export default function PhotoUpload({
  artikelnummer,
  onPhotoSelected,
  initialPhoto,
  disabled = false,
}) {
  const inputId = useId();
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (initialPhoto) {
      api
        .loadPhotoAsDataUrl(initialPhoto, { signal: controller.signal })
        .then((dataUrl) => {
          if (cancelled) return;
          if (dataUrl) {
            setPreview(dataUrl);
          } else {
            setPreview(null);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setPreview(null);
          setError(err.message);
        });
    } else {
      setPreview(null);
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialPhoto]);

  const handleFile = async (file) => {
    if (!file) return;

    if (disabled || !artikelnummer || !/\d/.test(String(artikelnummer))) {
      setError(
        "Bitte zuerst eine gültige Artikelnummer erzeugen, dann das Foto hochladen.",
      );
      return;
    }

    // Validiere Dateityp
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      setError("Nur JPG, PNG und GIF Dateien sind erlaubt");
      return;
    }

    // Validiere Dateigröße (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError("Datei ist zu groß (max. 5 MB)");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // Zeige Preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target.result);
      };
      reader.readAsDataURL(file);

      // Upload
      const result = await api.uploadFoto(file, artikelnummer);
      if (result.success || result.path) {
        onPhotoSelected(result.path);
      }
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="photo-upload-container">
      <div
        className={`drag-drop-zone ${dragActive ? "active" : ""}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id={inputId}
          accept="image/jpeg,image/png,image/gif"
          onChange={handleFileInput}
          disabled={uploading || disabled}
        />
        <label htmlFor={inputId} className="upload-label">
          <div className="upload-content">
            <div className="upload-icon">📸</div>
            <p>Ziehe Foto hier hin oder klicke zum Auswählen</p>
            <small>JPG, PNG, GIF (max. 5 MB)</small>
            {disabled && (
              <small style={{ color: "#666" }}>
                Bitte zuerst Hersteller, Grundmaterial und Produktart auswählen.
              </small>
            )}
          </div>
        </label>
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: "10px" }}>{error}</div>}

      {uploading && (
        <div style={{ marginTop: "10px", textAlign: "center" }}>
          <div className="spinner"></div>
          Hochladen...
        </div>
      )}

      {preview && (
        <div className="photo-preview">
          <img src={preview} alt="Vorschau" />
        </div>
      )}
    </div>
  );
}
