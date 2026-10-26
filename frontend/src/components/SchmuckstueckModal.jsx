import SchmuckstueckDetailPanel from "./SchmuckstueckDetailPanel";

// Schmuckstück-Details als Fenster über einem bestehenden Modal (Inventur, Belege, schmale Stückliste).
// Props wie SchmuckstueckDetailPanel.
export default function SchmuckstueckModal(props) {
  return (
    <div className="modal-overlay schmuck-modal-overlay-top">
      <div className="modal schmuck-modal" onClick={(e) => e.stopPropagation()}>
        <SchmuckstueckDetailPanel {...props} />
      </div>
    </div>
  );
}
