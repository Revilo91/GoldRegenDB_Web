import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar as faRegularStar } from "@fortawesome/free-regular-svg-icons";
import {
  faHashtag,
  faGem,
  faPen,
  faTrash,
  faPlus,
  faBoxOpen,
  faMagnifyingGlass,
  faEuroSign,
  faPaperclip,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import DataTable from "../components/DataTable";
import PhotoUpload from "../components/PhotoUpload";
import TableToolbar from "../components/TableToolbar";
import SchmuckstueckModal from "../components/SchmuckstueckModal";
import { useAuth } from "../context/AuthContext";

const HERSTELLER_OPTIONS = [
  { code: "M", label: "Marina" },
  { code: "S", label: "Saskia" },
];

const GRUNDMATERIAL_OPTIONS = [
  { code: "A", label: "Alkoholtinte" },
  { code: "B", label: "Beton" },
  { code: "C", label: "Cucio" },
  { code: "E", label: "Edelstahl" },
  { code: "F", label: "Fimo" },
  { code: "H", label: "Harz" },
  { code: "I", label: "Phiole" },
  { code: "J", label: "Papier" },
  { code: "K", label: "Kordel" },
  { code: "L", label: "Leder" },
  { code: "M", label: "Makramee" },
  { code: "N", label: "Naturstein" },
  { code: "P", label: "Perle" },
  { code: "S", label: "Schrumpffolie" },
  { code: "W", label: "Holz" },
  { code: "X", label: "3D-Druck" },
  { code: "Y", label: "Cabochon" },
];

const PRODUKTART_OPTIONS = [
  { code: "A", label: "Armband" },
  { code: "H", label: "Halskette" },
  { code: "O", label: "Ohrring" },
  { code: "S", label: "Schlüsselanhänger" },
];

const createRowId = () =>
  `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createEmptyMehrfachRow = () => ({
  _rowId: createRowId(),
  Artikelnummer: "",
  Name: "",
  Art: "",
  Material: "",
  Farbe: "",
  Verkaufspreis: 0,
  Herstellungskosten: 0,
  Form: "",
  Fassung: "",
});

const normalizeMehrfachArtikelnummer = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";

  // Wenn nur Basisnummer eingegeben wurde, beim Speichern automatisch _1 setzen.
  if (/^[A-Z]{3}\d{3}$/.test(normalized)) {
    return `${normalized}_1`;
  }

  return normalized;
};

export default function Schmuckstuecke() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user && (user.role === "admin" || user.role === "bearbeiter");
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [kunden, setKunden] = useState([]);
  const [sortConfig, setSortConfig] = useState({
    key: "Artikelnummer",
    direction: "asc",
  });
  const [nextArtikelnummerPreview, setNextArtikelnummerPreview] = useState("");
  const [nextArtikelnummerLoading, setNextArtikelnummerLoading] =
    useState(false);
  const [nextArtikelnummerError, setNextArtikelnummerError] = useState("");
  const [nextArtikelnummerRefreshKey, setNextArtikelnummerRefreshKey] =
    useState(0);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkTemplateArtikelnummer, setBulkTemplateArtikelnummer] =
    useState("");
  const [bulkLoadingTemplate, setBulkLoadingTemplate] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkRows, setBulkRows] = useState([createEmptyMehrfachRow()]);

  const buildPrefixFromCodes = (hersteller, grundmaterial, produktart) => {
    if (!hersteller || !grundmaterial || !produktart) return "";
    return `${hersteller}${grundmaterial}${produktart}`;
  };

  const load = () => {
    setLoading(true);
    api
      .getSchmuckstuecke({ page, limit: 50, search, ...filters })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleDelete = async (nr) => {
    if (!confirm(`Schmuckstück ${nr} wirklich löschen?`)) return;
    try {
      await api.deleteSchmuckstueck(nr);
      setSelected(null);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSave = async ({ closeAfterSave = true } = {}) => {
    try {
      const dataToSave = { ...form };

      if (editing === "new" && nextArtikelnummerPreview) {
        dataToSave.Artikelnummer = nextArtikelnummerPreview;
      }

      if (editing === "new" && !dataToSave.Artikelnummer) {
        alert(
          "Bitte Hersteller, Grundmaterial und Produktart auswählen, damit die Artikelnummer erzeugt werden kann.",
        );
        return;
      }

      if (editing === "new") {
        console.log("Creating new Schmuckstück with data:", dataToSave);
        await api.createSchmuckstueck(dataToSave);
        if (!closeAfterSave) {
          setForm((prev) => ({ ...prev, Foto: "" }));
          setNextArtikelnummerRefreshKey((prev) => prev + 1);
          alert(`${dataToSave.Artikelnummer} wurde erstellt.`);
        }
      } else {
        await api.updateSchmuckstueck(editing, dataToSave);
      }
      if (closeAfterSave || editing !== "new") {
        setEditing(null);
      }
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const openNew = () => {
    setForm({
      Artikelnummer: "",
      HerstellerCode: "",
      GrundmaterialCode: "",
      ProduktartCode: "",
      Anzahl: 1,
      Name: "",
      Art: "",
      Material: "",
      Farbe: "",
      Verkaufspreis: 0,
      Herstellungskosten: 0,
      Ausgelagert: 0,
      Verkauft: 0,
      Ausschuss: 0,
      Ausschuss_Grund: "",
    });
    setEditing("new");
  };

  const openBulkCreate = () => {
    setBulkTemplateArtikelnummer("");
    setBulkRows([createEmptyMehrfachRow()]);
    setBulkModalOpen(true);
  };

  const setBulkRowValue = (rowId, field, value) => {
    setBulkRows((prev) =>
      prev.map((row) =>
        row._rowId === rowId ? { ...row, [field]: value } : row,
      ),
    );
  };

  const addBulkRow = () => {
    setBulkRows((prev) => [...prev, createEmptyMehrfachRow()]);
  };

  const removeBulkRow = (rowId) => {
    setBulkRows((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row._rowId !== rowId);
    });
  };

  const duplicateBulkRow = (rowId) => {
    setBulkRows((prev) => {
      const source = prev.find((row) => row._rowId === rowId);
      if (!source) return prev;

      const copiedRow = {
        ...source,
        _rowId: createRowId(),
        // Artikelnummer bleibt absichtlich leer, damit keine Dublette gespeichert wird.
        Artikelnummer: "",
      };

      const insertIndex = prev.findIndex((row) => row._rowId === rowId);
      const next = [...prev];
      next.splice(insertIndex + 1, 0, copiedRow);
      return next;
    });
  };

  const loadBulkTemplate = async () => {
    const input = bulkTemplateArtikelnummer.trim().toUpperCase();
    if (!input) {
      alert("Bitte eine Artikelnummer als Vorlage eingeben.");
      return;
    }

    try {
      setBulkLoadingTemplate(true);
      let item = null;

      // 1) Direkter Treffer bzw. automatische _1-Ergänzung, falls kein Suffix eingegeben wurde.
      const candidateArtikelnummern = input.includes("_")
        ? [input]
        : [input, `${input}_1`];

      for (const candidate of candidateArtikelnummern) {
        try {
          item = await api.getSchmuckstueck(candidate);
          break;
        } catch {
          // Fallback folgt unten.
        }
      }

      // 2) Fallback: LIKE-ähnliche Suche nach Basisnummer + beliebigem Suffix.
      if (!item && !input.includes("_")) {
        const result = await api.getSchmuckstuecke({
          page: 1,
          limit: 200,
          search: input,
        });

        const matchingItems = (result?.data || [])
          .filter((row) =>
            String(row.Artikelnummer || "").startsWith(`${input}_`),
          )
          .sort((a, b) => {
            const aSuffix = parseInt(
              String(a.Artikelnummer).split("_")[1] || "0",
              10,
            );
            const bSuffix = parseInt(
              String(b.Artikelnummer).split("_")[1] || "0",
              10,
            );
            return aSuffix - bSuffix;
          });

        if (matchingItems.length > 0) {
          item = await api.getSchmuckstueck(matchingItems[0].Artikelnummer);
        }
      }

      if (!item) {
        throw new Error(
          "Kein passendes Schmuckstück gefunden. Bitte Artikelnummer mit Suffix (z.B. _1) prüfen.",
        );
      }

      setBulkRows((prev) => [
        ...prev,
        {
          ...createEmptyMehrfachRow(),
          Name: item.Name || "",
          Art: item.Art || "",
          Material: item.Material || "",
          Farbe: item.Farbe || "",
          Verkaufspreis: item.Verkaufspreis || 0,
          Herstellungskosten: item.Herstellungskosten || 0,
          Form: item.Form || "",
          Fassung: item.Fassung || "",
        },
      ]);
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkLoadingTemplate(false);
    }
  };

  const handleBulkSave = async () => {
    const items = bulkRows
      .map((row) => {
        const { _rowId, ...payloadRow } = row;
        return {
          ...payloadRow,
          Artikelnummer: normalizeMehrfachArtikelnummer(row.Artikelnummer),
        };
      })
      .filter((row) => row.Artikelnummer);

    if (items.length === 0) {
      alert("Bitte mindestens eine Zeile mit Artikelnummer eintragen.");
      return;
    }

    try {
      setBulkSaving(true);
      const result = await api.createSchmuckstueckeBulk({ items });

      alert(
        `${result.createdCount} Schmuckstücke wurden erfolgreich nachgetragen.`,
      );
      setBulkModalOpen(false);
      load();
    } catch (err) {
      const payload = err.payload || {};
      if (Array.isArray(payload.invalidArtikelnummern)) {
        alert(
          `Ungültige Artikelnummern:\n${payload.invalidArtikelnummern.join("\n")}`,
        );
        return;
      }
      if (Array.isArray(payload.existingArtikelnummern)) {
        alert(
          `Diese Artikelnummern existieren bereits:\n${payload.existingArtikelnummern.join("\n")}`,
        );
        return;
      }
      if (Array.isArray(payload.duplicateArtikelnummern)) {
        alert(
          `Diese Artikelnummern wurden doppelt eingegeben:\n${payload.duplicateArtikelnummern.join("\n")}`,
        );
        return;
      }
      alert(err.message);
    } finally {
      setBulkSaving(false);
    }
  };

  const openEdit = (s) => {
    setForm({
      ...s,
      Ausschuss_Grund: s.Ausschuss_Grund || "",
    });
    setEditing(s.Artikelnummer);
  };

  const openDuplicate = (s) => {
    const {
      ID,
      Erstelldatum,
      Letzte_Änderung,
      Lieferschein_ID,
      Rechnung_ID,
      Grundmaterial,
      Foto,
      ...copyData
    } = s;
    const baseArtikelnummer = String(s.Artikelnummer || "").split("_")[0];

    setForm({
      ...copyData,
      Artikelnummer: baseArtikelnummer,
      HerstellerCode: baseArtikelnummer[0] || "",
      GrundmaterialCode: baseArtikelnummer[1] || "",
      ProduktartCode: baseArtikelnummer[2] || "",
      Anzahl: 1,
      Foto: "",
      Ausgelagert: 0,
      Verkauft: 0,
      Ausschuss: 0,
      Ausschuss_Grund: "",
    });
    setEditing("new");
  };

  useEffect(() => {
    api.getFilterOptions().then(setFilterOptions).catch(console.error);
    api.getKunden().then(setKunden).catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [page, search, filters]);

  useEffect(() => {
    if (editing !== "new") {
      setNextArtikelnummerPreview("");
      setNextArtikelnummerError("");
      setNextArtikelnummerLoading(false);
      return;
    }

    const prefix = String(form.Artikelnummer || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(prefix)) {
      setNextArtikelnummerPreview("");
      setNextArtikelnummerError("");
      setNextArtikelnummerLoading(false);
      return;
    }

    let isCancelled = false;
    setNextArtikelnummerLoading(true);
    setNextArtikelnummerError("");

    api
      .getNextArtikelnummer(prefix)
      .then((result) => {
        if (isCancelled) return;
        setNextArtikelnummerPreview(result.artikelnummer || "");
      })
      .catch((err) => {
        if (isCancelled) return;
        setNextArtikelnummerPreview("");
        setNextArtikelnummerError(
          err.message || "Nächste Artikelnummer konnte nicht geladen werden.",
        );
      })
      .finally(() => {
        if (isCancelled) return;
        setNextArtikelnummerLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [editing, form.Artikelnummer, nextArtikelnummerRefreshKey]);

  useEffect(() => {
    const openEditArtikelnummer = location.state?.openEdit;
    const openDuplicateArtikelnummer = location.state?.openDuplicate;
    const targetArtikelnummer =
      openEditArtikelnummer || openDuplicateArtikelnummer;

    if (!targetArtikelnummer) return;

    api
      .getSchmuckstueck(targetArtikelnummer)
      .then((item) => {
        if (openEditArtikelnummer) {
          openEdit(item);
        } else {
          openDuplicate(item);
        }
      })
      .catch(console.error)
      .finally(() => {
        navigate(location.pathname, { replace: true, state: {} });
      });
  }, [location.pathname, location.state, navigate]);

  const getKundenName = (id) => {
    const kunde = kunden.find((k) => k.ID === id);
    return kunde ? kunde.Name : `Kundennummer ${id}`;
  };

  const p = data.pagination;
  const isForegroundModalOpen = selected !== null || editing !== null;

  const sortedData = useMemo(() => {
    let sortableData = [...data.data];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === "Ausgelagert") {
          aValue = getKundenName(a.Ausgelagert).toUpperCase();
          bValue = getKundenName(b.Ausgelagert).toUpperCase();
          if (a.Ausgelagert === 0) aValue = "";
          if (b.Ausgelagert === 0) bValue = "";
        }

        if (sortConfig.key === "Artikelnummer") {
          return sortConfig.direction === "asc"
            ? aValue.localeCompare(bValue, undefined, { numeric: true })
            : bValue.localeCompare(aValue, undefined, { numeric: true });
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [data.data, sortConfig, kunden]);

  function TablePhoto({ foto, artikelnummer, pauseLoading = false }) {
    const [photoSrc, setPhotoSrc] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [photoError, setPhotoError] = useState(null);

    useEffect(() => {
      let isCancelled = false;
      const controller = new AbortController();

      if (!foto) {
        setPhotoSrc(null);
        setPhotoError(null);
        setIsLoading(false);
        return () => {
          isCancelled = true;
          controller.abort();
        };
      }

      if (pauseLoading) {
        setIsLoading(false);
        return () => {
          isCancelled = true;
          controller.abort();
        };
      }

      setIsLoading(true);
      setPhotoError(null);
      api
        .loadPhotoAsDataUrl(foto, { signal: controller.signal })
        .then((dataUrl) => {
          if (isCancelled) return;
          setPhotoSrc(dataUrl);
        })
        .catch((err) => {
          if (isCancelled) return;
          setPhotoSrc(null);
          setPhotoError(err.message);
        })
        .finally(() => {
          if (isCancelled) return;
          setIsLoading(false);
        });

      return () => {
        isCancelled = true;
        controller.abort();
      };
    }, [foto, pauseLoading]);

    if (!photoSrc) {
      return (
        <span
          className="table-photo-placeholder"
          title={
            isLoading
              ? "Foto wird geladen"
              : photoError
                ? `Foto konnte nicht geladen werden: ${photoError}`
                : "Kein Foto verfügbar"
          }>
          <FontAwesomeIcon icon={faGem} />
        </span>
      );
    }

    return (
      <img
        className="table-photo-thumb"
        src={photoSrc}
        alt={`Foto ${artikelnummer}`}
        loading="lazy"
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Schmuckstücke</h2>
          <p>{p.total || 0} Stücke insgesamt</p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {canEdit && (
            <button className="btn btn-secondary" onClick={openBulkCreate}>
              + Schmuckstücke nachtragen
            </button>
          )}
          <button className="btn btn-primary" onClick={openNew}>
            + Neues Schmuckstück
          </button>
        </div>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Suche nach Artikelnummer, Name, Art, Material..."
        right={
          <div className="filter-group">
            <select
              className="form-control"
              value={filters.artikelnummer_art ?? ""}
              onChange={(e) => {
                const { artikelnummer_art, ...rest } = filters;
                setFilters(
                  e.target.value !== ""
                    ? { ...rest, artikelnummer_art: e.target.value }
                    : rest,
                );
                setPage(1);
              }}>
              <option value="">Alle Arten</option>
              <option value="A">Armband</option>
              <option value="H">Halskette</option>
              <option value="O">Ohrring</option>
              <option value="S">Schlüsselanhänger</option>
            </select>
            <select
              className="form-control"
              value={filters.ausgelagert ?? ""}
              onChange={(e) => {
                const { ausgelagert, ...rest } = filters;
                setFilters(
                  e.target.value !== ""
                    ? { ...rest, ausgelagert: e.target.value }
                    : rest,
                );
                setPage(1);
              }}>
              <option value="">Alle Standorte</option>
              <option value="0">Lager</option>
              {kunden.map((k) => (
                <option key={k.ID} value={k.ID}>
                  {k.Name}
                </option>
              ))}
            </select>
            <select
              className="form-control"
              value={filters.verkauft ?? ""}
              onChange={(e) => {
                const { verkauft, ...rest } = filters;
                setFilters(
                  e.target.value !== ""
                    ? { ...rest, verkauft: e.target.value }
                    : rest,
                );
                setPage(1);
              }}>
              <option value="">Status</option>
              <option value="0">Nicht verkauft</option>
              <option value="1">Verkauft</option>
            </select>
          </div>
        }
      />

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade...
            </div>
          ) : (
            <DataTable
              data={sortedData}
              getRowKey={(r) => r.Artikelnummer}
              defaultSort={{ key: "Artikelnummer", direction: "asc" }}
              onRowClick={(s) => setSelected(s)}
              columns={[
                {
                  key: "foto",
                  label: "Foto",
                  className: "photo-col",
                  render: (r) => (
                    <TablePhoto
                      foto={r.Foto}
                      artikelnummer={r.Artikelnummer}
                      pauseLoading={isForegroundModalOpen}
                    />
                  ),
                },
                {
                  key: "Artikelnummer",
                  label: "Artikelnr.",
                  sortable: true,
                  render: (r) => {
                    const parts = String(r.Artikelnummer).split("_");
                    return (
                      <>
                        <strong>{parts[0]}</strong>
                        {parts[1] > 0 && (
                          <span className="badge warning">{parts[1]}</span>
                        )}
                      </>
                    );
                  },
                },
                {
                  key: "Grundmaterial",
                  label: "Grundmaterial",
                  className: "hide-on-mobile",
                  sortable: true,
                },
                {
                  key: "Art",
                  label: "Art",
                  className: "hide-on-mobile",
                  sortable: true,
                },
                {
                  key: "Material",
                  label: "Material",
                  className: "hide-on-mobile",
                  sortable: true,
                },
                {
                  key: "Farbe",
                  label: "Farbe",
                  className: "hide-on-mobile",
                  sortable: true,
                },
                {
                  key: "Inhalt_Farbe",
                  label: "Farbe Inhalt",
                  className: "hide-on-mobile",
                  sortable: true,
                },
                {
                  key: "Verkaufspreis",
                  label: "Preis",
                  sortable: true,
                  render: (r) =>
                    r.Verkaufspreis > 0 ? `${r.Verkaufspreis}€` : "-",
                },
                {
                  key: "Status",
                  label: "Status",
                  sortable: true,
                  render: (r) =>
                    r.Verkauft === 1 ? (
                      <span className="badge success">Verkauft</span>
                    ) : r.Ausschuss === 1 ? (
                      <span className="badge danger">Ausschuss</span>
                    ) : r.Verkauft === 0 &&
                      r.Ausschuss === 0 &&
                      r.Ausgelagert === 0 ? (
                      <span className="badge gold">Lager</span>
                    ) : null,
                },
                {
                  key: "Ausgelagert",
                  label: "Ausgelagert",
                  render: (r) =>
                    r.Ausgelagert > 0 ? (
                      <span className="badge warning">
                        {getKundenName(r.Ausgelagert)}
                      </span>
                    ) : (
                      "-"
                    ),
                },
              ]}
            />
          )}
        </div>
        {p.totalPages > 1 && (
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Zurück
            </button>
            <span className="page-info">
              Seite {page} von {p.totalPages}
            </span>
            <button
              disabled={page >= p.totalPages}
              onClick={() => setPage(page + 1)}>
              Weiter →
            </button>
          </div>
        )}
      </div>

      {selected && (
        <SchmuckstueckModal
          artikelnummer={selected.Artikelnummer}
          onClose={() => setSelected(null)}
          onDuplicate={
            canEdit
              ? (item) => {
                  setSelected(null);
                  item && openDuplicate(item);
                }
              : undefined
          }
          onEdit={
            canEdit
              ? () => {
                  setSelected(null);
                  openEdit(selected);
                }
              : undefined
          }
          onDelete={
            canEdit ? () => handleDelete(selected.Artikelnummer) : undefined
          }
        />
      )}

      {bulkModalOpen && (
        <div className="modal-overlay">
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%" }}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={faPlus} /> Mehrere Schmuckstücke
                nachtragen
              </h3>
              <button
                className="modal-close"
                onClick={() => setBulkModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faCopy} /> Vorlage (optional)
                </h4>
                <div
                  className="form-row"
                  style={{
                    gridTemplateColumns: "1fr 220px",
                    alignItems: "end",
                  }}>
                  <div className="form-group">
                    <label>Bestehendes Schmuckstück laden</label>
                    <input
                      className="form-control"
                      value={bulkTemplateArtikelnummer}
                      onChange={(e) =>
                        setBulkTemplateArtikelnummer(
                          e.target.value.toUpperCase(),
                        )
                      }
                      placeholder="z.B. MBH001_1"
                    />
                  </div>
                  <div className="form-group">
                    <button
                      className="btn btn-secondary"
                      onClick={loadBulkTemplate}
                      disabled={bulkLoadingTemplate}>
                      {bulkLoadingTemplate
                        ? "Lade Vorlage..."
                        : "Als neue Zeile übernehmen"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faHashtag} /> Tabelle für
                  Mehrfach-Erfassung
                </h4>
                <div className="table-container" style={{ overflowX: "auto" }}>
                  <DataTable
                    className="table"
                    data={bulkRows}
                    defaultSort={{ key: null, direction: "asc" }}
                    getRowKey={(row) => row._rowId}
                    columns={[
                      {
                        key: "rownum",
                        label: "#",
                        render: (row) =>
                          bulkRows.findIndex((r) => r._rowId === row._rowId) +
                          1,
                      },
                      {
                        key: "Artikelnummer",
                        label: "Artikelnummer*",
                        render: (row) => {
                          return (
                            <input
                              className="form-control"
                              value={row.Artikelnummer || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Artikelnummer",
                                  e.target.value.toUpperCase(),
                                )
                              }
                              placeholder="MBH001_2"
                            />
                          );
                        },
                      },
                      {
                        key: "Name",
                        label: "Name",
                        render: (row) => {
                          return (
                            <input
                              className="form-control"
                              value={row.Name || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Name",
                                  e.target.value,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "Art",
                        label: "Art",
                        render: (row) => {
                          return (
                            <input
                              list="bulk-arten-list"
                              className="form-control"
                              value={row.Art || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Art",
                                  e.target.value,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "Material",
                        label: "Material",
                        render: (row) => {
                          return (
                            <input
                              list="bulk-material-list"
                              className="form-control"
                              value={row.Material || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Material",
                                  e.target.value,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "Farbe",
                        label: "Farbe",
                        render: (row) => {
                          return (
                            <input
                              list="bulk-farbe-list"
                              className="form-control"
                              value={row.Farbe || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Farbe",
                                  e.target.value,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "Verkaufspreis",
                        label: "VK (€)",
                        render: (row) => {
                          return (
                            <input
                              className="form-control"
                              type="number"
                              step="0.01"
                              value={row.Verkaufspreis || 0}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Verkaufspreis",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "Form",
                        label: "Form",
                        render: (row) => {
                          return (
                            <input
                              list="bulk-formen-list"
                              className="form-control"
                              value={row.Form || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Form",
                                  e.target.value,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "Fassung",
                        label: "Fassung",
                        render: (row) => {
                          return (
                            <input
                              list="bulk-fassung-list"
                              className="form-control"
                              value={row.Fassung || ""}
                              onChange={(e) =>
                                setBulkRowValue(
                                  row._rowId,
                                  "Fassung",
                                  e.target.value,
                                )
                              }
                            />
                          );
                        },
                      },
                      {
                        key: "aktion",
                        label: "Aktion",
                        render: (row) => {
                          return (
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => duplicateBulkRow(row._rowId)}
                                disabled={bulkSaving}
                                title="Zeile kopieren">
                                <FontAwesomeIcon icon={faCopy} />
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => removeBulkRow(row._rowId)}
                                disabled={bulkRows.length <= 1 || bulkSaving}
                                title="Zeile löschen">
                                <FontAwesomeIcon icon={faTrash} />
                              </button>
                            </div>
                          );
                        },
                      },
                    ]}
                  />
                </div>
                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                  <button className="btn btn-secondary" onClick={addBulkRow}>
                    <FontAwesomeIcon icon={faPlus} /> Zeile hinzufügen
                  </button>
                </div>
              </div>

              <datalist id="bulk-arten-list">
                {filterOptions.arten?.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              <datalist id="bulk-material-list">
                {filterOptions.materialien?.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <datalist id="bulk-farbe-list">
                {filterOptions.farben?.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <datalist id="bulk-formen-list">
                {filterOptions.formen?.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <datalist id="bulk-fassung-list">
                {filterOptions.fassungen?.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setBulkModalOpen(false)}
                disabled={bulkSaving}>
                Abbrechen
              </button>
              <button
                className="btn btn-primary"
                onClick={handleBulkSave}
                disabled={bulkSaving}>
                {bulkSaving ? "Speichere..." : "Mehrfach speichern"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing !== null && (
        <div className="modal-overlay">
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "900px" }}>
            <div className="modal-header">
              <h3>
                {editing === "new" ? (
                  <>
                    <FontAwesomeIcon icon={faPlus} /> Neues Schmuckstück
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faPen} /> {editing} bearbeiten
                  </>
                )}
              </h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faHashtag} /> Artikelnummer
                </h4>
                {editing === "new" ? (
                  <>
                    <div
                      className="form-row"
                      style={{
                        gridTemplateColumns: "1fr 1fr 1fr 120px",
                        alignItems: "end",
                      }}>
                      <div className="form-group">
                        <label>Hersteller*</label>
                        <select
                          className="form-control"
                          value={form.HerstellerCode || ""}
                          onChange={(e) => {
                            const hersteller = e.target.value;
                            const artikelnummer = buildPrefixFromCodes(
                              hersteller,
                              form.GrundmaterialCode,
                              form.ProduktartCode,
                            );
                            setForm({
                              ...form,
                              HerstellerCode: hersteller,
                              Artikelnummer: artikelnummer,
                            });
                          }}>
                          <option value="">Hersteller</option>
                          {HERSTELLER_OPTIONS.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.code} - {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Grundmaterial*</label>
                        <select
                          className="form-control"
                          value={form.GrundmaterialCode || ""}
                          onChange={(e) => {
                            const grundmaterial = e.target.value;
                            const artikelnummer = buildPrefixFromCodes(
                              form.HerstellerCode,
                              grundmaterial,
                              form.ProduktartCode,
                            );
                            setForm({
                              ...form,
                              GrundmaterialCode: grundmaterial,
                              Artikelnummer: artikelnummer,
                            });
                          }}>
                          <option value="">Grundmaterial</option>
                          {GRUNDMATERIAL_OPTIONS.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.code} - {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Produktart*</label>
                        <select
                          className="form-control"
                          value={form.ProduktartCode || ""}
                          onChange={(e) => {
                            const produktart = e.target.value;
                            const artikelnummer = buildPrefixFromCodes(
                              form.HerstellerCode,
                              form.GrundmaterialCode,
                              produktart,
                            );
                            setForm({
                              ...form,
                              ProduktartCode: produktart,
                              Artikelnummer: artikelnummer,
                            });
                          }}>
                          <option value="">Produktart</option>
                          {PRODUKTART_OPTIONS.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.code} - {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Anzahl</label>
                        <input
                          className="form-control"
                          type="number"
                          min="1"
                          value={form.Anzahl || 1}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              Anzahl: parseInt(e.target.value) || 1,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Artikelnummer*</label>
                        <div
                          className="form-control"
                          style={{ display: "flex", alignItems: "center" }}>
                          {nextArtikelnummerPreview ||
                            form.Artikelnummer ||
                            "---"}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Artikelnummer*</label>
                      <input
                        className="form-control"
                        disabled
                        value={form.Artikelnummer || ""}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faBoxOpen} /> Basis-Informationen
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      className="form-control"
                      value={form.Name || ""}
                      onChange={(e) =>
                        setForm({ ...form, Name: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Art</label>
                    <input
                      list="arten-list"
                      className="form-control"
                      value={form.Art || ""}
                      onChange={(e) =>
                        setForm({ ...form, Art: e.target.value })
                      }
                    />
                    <datalist id="arten-list">
                      {filterOptions.arten?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Material</label>
                    <input
                      list="material-list"
                      className="form-control"
                      value={form.Material || ""}
                      onChange={(e) =>
                        setForm({ ...form, Material: e.target.value })
                      }
                    />
                    <datalist id="material-list">
                      {filterOptions.materialien?.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Farbe</label>
                    <input
                      list="farben-list"
                      className="form-control"
                      value={form.Farbe || ""}
                      onChange={(e) =>
                        setForm({ ...form, Farbe: e.target.value })
                      }
                    />
                    <datalist id="farben-list">
                      {filterOptions.farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>� Foto</h4>
                <PhotoUpload
                  artikelnummer={
                    editing === "new"
                      ? nextArtikelnummerPreview
                      : form.Artikelnummer
                  }
                  disabled={editing === "new" && !nextArtikelnummerPreview}
                  initialPhoto={form.Foto}
                  onPhotoSelected={(photoPath) => {
                    setForm({ ...form, Foto: photoPath });
                  }}
                />
              </div>

              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faMagnifyingGlass} /> Details
                  (Hauptstück)
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Form</label>
                    <input
                      list="formen-list"
                      className="form-control"
                      value={form.Form || ""}
                      onChange={(e) =>
                        setForm({ ...form, Form: e.target.value })
                      }
                    />
                    <datalist id="formen-list">
                      {filterOptions.formen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Größe</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.1"
                      value={form.Grösse || 0}
                      onChange={(e) =>
                        setForm({ ...form, Grösse: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Länge (cm)</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.1"
                      value={form.Länge || 0}
                      onChange={(e) =>
                        setForm({ ...form, Länge: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Fassung</label>
                    <input
                      list="fassungen-list"
                      className="form-control"
                      value={form.Fassung || ""}
                      onChange={(e) =>
                        setForm({ ...form, Fassung: e.target.value })
                      }
                    />
                    <datalist id="fassungen-list">
                      {filterOptions.fassungen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faRegularStar} /> Inhalt
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Inhalt Material</label>
                    <input
                      list="inhalt-material-list"
                      className="form-control"
                      value={form.Inhalt_Material || ""}
                      onChange={(e) =>
                        setForm({ ...form, Inhalt_Material: e.target.value })
                      }
                    />
                    <datalist id="inhalt-material-list">
                      {filterOptions.inhalt_materialien?.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Inhalt Farbe</label>
                    <input
                      list="inhalt-farbe-list"
                      className="form-control"
                      value={form.Inhalt_Farbe || ""}
                      onChange={(e) =>
                        setForm({ ...form, Inhalt_Farbe: e.target.value })
                      }
                    />
                    <datalist id="inhalt-farbe-list">
                      {filterOptions.inhalt_farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Inhalt Farbakzent</label>
                    <input
                      list="inhalt-farbakzent-list"
                      className="form-control"
                      value={form.Inhalt_Farbakzent || ""}
                      onChange={(e) =>
                        setForm({ ...form, Inhalt_Farbakzent: e.target.value })
                      }
                    />
                    <datalist id="inhalt-farbakzent-list">
                      {filterOptions.inhalt_farbakzente?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Inhalt Zusatzmaterial</label>
                    <input
                      list="inhalt-zusatzmaterial-list"
                      className="form-control"
                      value={form.Inhalt_Zusatzmaterial || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Inhalt_Zusatzmaterial: e.target.value,
                        })
                      }
                    />
                    <datalist id="inhalt-zusatzmaterial-list">
                      {filterOptions.inhalt_zusatzmaterialien?.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faPaperclip} /> Anhänger
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Anhänger Fassung</label>
                    <input
                      list="anhaenger-fassung-list"
                      className="form-control"
                      value={form.Anhänger_Fassung || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger_Fassung: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-fassung-list">
                      {filterOptions.anhaenger_fassungen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger Form</label>
                    <input
                      list="anhaenger-form-list"
                      className="form-control"
                      value={form.Anhänger_Form || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger_Form: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-form-list">
                      {filterOptions.anhaenger_formen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger Farbe</label>
                    <input
                      list="anhaenger-farbe-list"
                      className="form-control"
                      value={form.Anhänger_Farbe || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger_Farbe: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-farbe-list">
                      {filterOptions.anhaenger_farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger Größe</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.1"
                      value={form.Anhänger_Grösse || 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Grösse: parseFloat(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Anh. Inhalt Material</label>
                    <input
                      list="anhaenger-inhalt-material-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Material || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Material: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-material-list">
                      {filterOptions.anhaenger_inhalt_materialien?.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anh. Inhalt Farbe</label>
                    <input
                      list="anhaenger-inhalt-farbe-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Farbe || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Farbe: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-farbe-list">
                      {filterOptions.anhaenger_inhalt_farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anh. Inhalt Farbakzent</label>
                    <input
                      list="anhaenger-inhalt-farbakzent-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Farbakzente || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Farbakzente: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-farbakzent-list">
                      {filterOptions.anhaenger_inhalt_farbakzente?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anh. Inhalt Zusatzmaterial</label>
                    <input
                      list="anhaenger-inhalt-zusatzmaterial-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Zusatzmaterial || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Zusatzmaterial: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-zusatzmaterial-list">
                      {filterOptions.anhaenger_inhalt_zusatzmaterialien?.map(
                        (z) => (
                          <option key={z} value={z} />
                        ),
                      )}
                    </datalist>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Zwischenstück</label>
                    <input
                      list="zwischenstuecke-list"
                      className="form-control"
                      value={form.Zwischenstück || ""}
                      onChange={(e) =>
                        setForm({ ...form, Zwischenstück: e.target.value })
                      }
                    />
                    <datalist id="zwischenstuecke-list">
                      {filterOptions.zwischenstuecke?.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Fassung</label>
                    <input
                      list="fassungen-list"
                      className="form-control"
                      value={form.Fassung || ""}
                      onChange={(e) =>
                        setForm({ ...form, Fassung: e.target.value })
                      }
                    />
                    <datalist id="fassungen-list">
                      {filterOptions.fassungen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger (Allg.)</label>
                    <input
                      list="anhaenger-list"
                      className="form-control"
                      value={form.Anhänger || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-list">
                      {filterOptions.anhaenger?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>
                  <FontAwesomeIcon icon={faEuroSign} /> Inventar & Preise
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Verkaufspreis (€)</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      value={form.Verkaufspreis || 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Verkaufspreis: parseFloat(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Herstellungskosten (€)</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      value={form.Herstellungskosten || 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Herstellungskosten: parseFloat(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Standort / Ausgelagert</label>
                    <select
                      className="form-control"
                      value={form.Ausgelagert || 0}
                      disabled={editing === "new"}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Ausgelagert: parseInt(e.target.value),
                        })
                      }>
                      <option value="0">Lager</option>
                      {kunden.map((k) => (
                        <option key={k.ID} value={k.ID}>
                          {k.Name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {editing !== "new" ? (
                  <>
                    <div className="form-row" style={{ marginTop: "16px" }}>
                      <div className="form-group checkbox-field">
                        <input
                          type="checkbox"
                          id="form-ausschuss"
                          className="form-checkbox"
                          checked={form.Ausschuss === 1}
                          disabled={editing === "new"}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              Ausschuss: e.target.checked ? 1 : 0,
                              Ausschuss_Grund: e.target.checked
                                ? form.Ausschuss_Grund || "Defekt"
                                : "",
                            })
                          }
                        />
                        <label
                          htmlFor="form-ausschuss"
                          className="checkbox-label">
                          Ausschuss
                        </label>
                      </div>

                      {form.Ausschuss === 1 && (
                        <div className="form-row" style={{ marginTop: "12px" }}>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label>Ausschuss Grund</label>
                            <input
                              list="ausschussgruende-list"
                              className="form-control"
                              value={form.Ausschuss_Grund || ""}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  Ausschuss_Grund: e.target.value,
                                })
                              }
                              placeholder="z.B. Defekt"
                            />
                            <datalist id="ausschussgruende-list">
                              {filterOptions.ausschussgruende?.map((g) => (
                                <option key={g} value={g} />
                              ))}
                            </datalist>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  ""
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(null)}>
                Abbrechen
              </button>
              {editing === "new" ? (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleSave({ closeAfterSave: true })}>
                    Speichern + Schließen
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleSave({ closeAfterSave: false })}>
                    Speichern + Weiter
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => handleSave({ closeAfterSave: true })}>
                  Speichern
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
