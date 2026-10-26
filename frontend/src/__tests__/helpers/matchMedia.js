// Ersetzt window.matchMedia für "(max-width: Npx)"-Abfragen; setze() ändert die Breite und benachrichtigt Hörer.
export function mockeBreite(anfangsbreite) {
  let breite = anfangsbreite;
  const hoerer = new Set();
  const trifft = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return max ? breite <= Number(max[1]) : false;
  };
  window.matchMedia = (query) => ({
    get matches() {
      return trifft(query);
    },
    media: query,
    addEventListener: (_art, fn) => hoerer.add(fn),
    removeEventListener: (_art, fn) => hoerer.delete(fn),
  });
  return {
    setze(neu) {
      breite = neu;
      hoerer.forEach((fn) => fn());
    },
  };
}
