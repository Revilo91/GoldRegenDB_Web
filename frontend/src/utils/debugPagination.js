export const DEBUG_PAGE_SIZE = 100;

// "x–y von total" für die aktuelle Seite; leere Seite → "0 von total"
export function debugSeitenInfo(offset, anzahl, total) {
  if (anzahl === 0) return `0 von ${total}`;
  return `${offset + 1}–${offset + anzahl} von ${total}`;
}

export const hatVorherigeSeite = (offset) => offset > 0;
export const hatNaechsteSeite = (offset, anzahl, total) => offset + anzahl < total;
