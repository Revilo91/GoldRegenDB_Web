// Handy-Schwelle: bis einschließlich dieser Breite (px) gilt die Handy-Ansicht.
// Dieselbe Zahl wie @media (max-width: 768px) in styles/responsive.css.
export const MOBILE_BREAKPOINT = 768;
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

// Ab dieser Breite (px) steht das Stück-Detail als Panel neben der Liste, darunter als Fenster.
// Dieselbe Zahl wie @media (min-width: 1024px) in styles/schmuckstueck-panel.css.
export const PANEL_BREAKPOINT = 1024;
export const PANEL_QUERY = `(min-width: ${PANEL_BREAKPOINT}px)`;
