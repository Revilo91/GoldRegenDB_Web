import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faCircleExclamation,
  faInfoCircle,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

// Ersetzt die 68 blockierenden alert() im Projekt (Befund G19). alert() hatte
// zwei Probleme: es blockiert den Tab, und zwei Fehler kurz hintereinander
// ergaben zwei Dialoge, die man nacheinander wegklicken musste — in der
// Schmuckstückliste passierte das bei jedem Tastendruck.
//
// Gleiche Meldungen werden deshalb zusammengefasst statt gestapelt: kommt
// derselbe Text erneut, läuft nur die Anzeigedauer neu an.

const ToastContext = createContext(null);

const DAUER_MS = { fehler: 8000, erfolg: 4000, info: 5000 };

const SYMBOL = {
  fehler: faCircleExclamation,
  erfolg: faCheckCircle,
  info: faInfoCircle,
};

export function ToastProvider({ children }) {
  const [meldungen, setMeldungen] = useState([]);
  const naechsteId = useRef(1);
  const timer = useRef(new Map());

  const entfernen = useCallback((id) => {
    const laufend = timer.current.get(id);
    if (laufend) {
      clearTimeout(laufend);
      timer.current.delete(id);
    }
    setMeldungen((vorher) => vorher.filter((m) => m.id !== id));
  }, []);

  const planeAusblenden = useCallback(
    (id, dauer) => {
      const laufend = timer.current.get(id);
      if (laufend) clearTimeout(laufend);
      timer.current.set(
        id,
        setTimeout(() => entfernen(id), dauer),
      );
    },
    [entfernen],
  );

  const zeige = useCallback(
    (art, text) => {
      const inhalt = String(text ?? "").trim();
      if (!inhalt) return null;
      const dauer = DAUER_MS[art] ?? DAUER_MS.info;

      let id = null;
      setMeldungen((vorher) => {
        const vorhanden = vorher.find(
          (m) => m.art === art && m.text === inhalt,
        );
        if (vorhanden) {
          id = vorhanden.id;
          return vorher;
        }
        id = naechsteId.current;
        naechsteId.current += 1;
        return [...vorher, { id, art, text: inhalt }];
      });
      if (id !== null) planeAusblenden(id, dauer);
      return id;
    },
    [planeAusblenden],
  );

  useEffect(() => {
    const laufende = timer.current;
    return () => {
      laufende.forEach((t) => clearTimeout(t));
      laufende.clear();
    };
  }, []);

  const wert = useMemo(
    () => ({
      fehler: (text) => zeige("fehler", text),
      erfolg: (text) => zeige("erfolg", text),
      info: (text) => zeige("info", text),
      entfernen,
    }),
    [zeige, entfernen],
  );

  return (
    <ToastContext.Provider value={wert}>
      {children}
      <div className="toast-bereich" aria-live="polite">
        {meldungen.map(({ id, art, text }) => (
          <div
            key={id}
            className={`toast toast-${art}`}
            role={art === "fehler" ? "alert" : "status"}>
            <FontAwesomeIcon icon={SYMBOL[art] ?? faInfoCircle} />
            <span className="toast-text">{text}</span>
            <button
              type="button"
              className="toast-schliessen"
              aria-label="Meldung schließen"
              onClick={() => entfernen(id)}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Provider und Hook in einer Datei – dieselbe Aufteilung wie in
// context/AuthContext.jsx, samt derselben Ausnahme fuer Fast Refresh.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const wert = useContext(ToastContext);
  if (!wert) {
    throw new Error("useToast() braucht einen <ToastProvider> im Baum");
  }
  return wert;
}
