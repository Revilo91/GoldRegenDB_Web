import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faBox,
  faTrash,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";

import DocumentManager from "./DocumentManager";
import { api } from "../api";
import DataTable from "../components/DataTable";

export default function Lieferscheine() {
  return (
    <DocumentManager
      type="lieferschein"
      api={{
        getList: api.getLieferscheine,
        getNextNumber: api.getNextLieferscheinnummer,
        getDetail: api.getLieferschein,
        deleteItem: api.deleteLieferschein,
        createItem: api.createLieferschein,
        updateItem: api.updateLieferschein,
        exportExcel: api.exportLieferscheinExcel,
        getKunden: api.getKunden,
        getPieces: (filter) => api.getSchmuckstuecke(filter),
      }}
      icons={{ header: faBox, modal: faBox, user: faUser, trash: faTrash, times: faTimes }}
      labels={{
        header: "Lieferscheine",
        newBtn: "+ Neuer Lieferschein",
        modalTitle: "🆕 Neuer Lieferschein",
        excel: "Lieferschein erstellen",
        delete: "Löschen",
        deleteConfirm: "Lieferschein wirklich löschen?",
        excelFilePrefix: "Lieferschein",
        kundeRequired: "Bitte Kunde angeben.",
        pieceNotFound: (nr) => `Artikelnummer \"${nr}\" nicht gefunden oder nicht verfügbar.`,
      }}
      pieceFilter={() => ({ ausgelagert: "0", verkauft: "0", ausschuss: "0", limit: -1 })}
      pieceSelectMode="all"
    />
  );
}