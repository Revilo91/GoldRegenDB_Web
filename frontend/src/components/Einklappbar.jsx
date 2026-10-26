import { useState } from 'react';

// Abschnitt mit Kopfzeile zum Auf- und Zuklappen; startOffen gilt nur beim ersten Anzeigen
export default function Einklappbar({ titel, startOffen = false, children }) {
  const [offen, setOffen] = useState(startOffen);

  return (
    <div className="einklappbar">
      <button
        type="button"
        className="einklappbar-kopf"
        aria-expanded={offen}
        onClick={() => setOffen(!offen)}>
        <span className="einklappbar-pfeil" aria-hidden="true">
          {offen ? '▾' : '▸'}
        </span>
        {titel}
      </button>
      {offen && <div className="einklappbar-inhalt">{children}</div>}
    </div>
  );
}
