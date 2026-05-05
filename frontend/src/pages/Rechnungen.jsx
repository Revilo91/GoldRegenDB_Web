import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faFileInvoice,
  faTrash,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";

import DocumentManager from "./DocumentManager";
import { api } from "../api";
import DataTable from "../components/DataTable";

export default function Rechnungen() {
  return (
    <DocumentManager
      type="rechnung"
      api={{
        getList: api.getRechnungen,
        getNextNumber: api.getNextRechnungsnummer,
        getDetail: api.getRechnung,
        deleteItem: api.deleteRechnung,
        createItem: api.createRechnung,
        exportExcel: api.exportRechnungExcel,
        getKunden: api.getKunden,
        getPieces: (filter) => api.getSchmuckstuecke(filter),
      }}
      icons={{ header: faFileInvoice, modal: faFileInvoice, user: faUser, trash: faTrash, times: faTimes }}
      labels={{
        header: "Rechnungen",
        newBtn: "+ Neue Rechnung",
        modalTitle: "🆕 Neue Rechnung",
        excel: "Rechnung erstellen",
        delete: "Löschen",
        deleteConfirm: "Rechnung wirklich löschen?",
        excelFilePrefix: "Rechnung",
        kundeRequired: "Bitte Kunde angeben.",
        pieceNotFound: (nr) => `Artikelnummer \"${nr}\" nicht gefunden oder nicht beim Kunden ausgelagert.`,
      }}
      pieceFilter={(form) => ({ ausgelagert: form.Kundennummer, verkauft: "0", ausschuss: "0", limit: -1 })}
      pieceSelectMode="byKunde"
    />
  );
}
