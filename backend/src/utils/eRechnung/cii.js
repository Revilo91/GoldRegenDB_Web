// UN/CEFACT Cross Industry Invoice (D16B) – gemeinsame Syntax für XRechnung (CII) und ZUGFeRD/Factur-X.
// Die Elementreihenfolge folgt dem XSD; die BT-Nummern verweisen auf die EN 16931.

const esc = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

// Textelement: el('ram:ID', 'x') → <ram:ID>x</ram:ID>; leere Werte werden ausgelassen.
const el = (name, text, a = {}) =>
  text === null || text === undefined || text === '' ? '' : `<${name}${attrs(a)}>${esc(text)}</${name}>`;

// Container aus bereits serialisierten Kindelementen; ohne Kinder entfällt er.
function grp(name, ...kinder) {
  const body = kinder.filter(Boolean).join('');
  return body ? `<${name}>${body}</${name}>` : '';
}

// Peppol-Standardprozess „Billing“; von XRechnung (PEPPOL-EN16931-R001) verlangt
const GESCHAEFTSPROZESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

const betrag = (c) => (c / 100).toFixed(2);
const zweistellig = (n) => String(n).padStart(2, '0');
const datum102 = (d) => el('udt:DateTimeString',
  `${d.getFullYear()}${zweistellig(d.getMonth() + 1)}${zweistellig(d.getDate())}`, { format: '102' });
const indikator = (wert) => grp('ram:ChargeIndicator', el('udt:Indicator', String(wert)));

function steuer(m, { mitBetrag = false, basis } = {}) {
  return grp('ram:ApplicableTradeTax',
    mitBetrag && el('ram:CalculatedAmount', betrag(m.summen.steuer)),
    el('ram:TypeCode', 'VAT'),
    mitBetrag && el('ram:ExemptionReason', m.steuer.befreiungsgrund),
    basis !== undefined && el('ram:BasisAmount', betrag(basis)),
    el('ram:CategoryCode', m.steuer.kategorie),
    el('ram:RateApplicablePercent', String(m.steuer.satz)),
  );
}

function position(m, p) {
  return grp('ram:IncludedSupplyChainTradeLineItem',
    grp('ram:AssociatedDocumentLineDocument', el('ram:LineID', p.id)),                    // BT-126
    grp('ram:SpecifiedTradeProduct',
      el('ram:SellerAssignedID', p.artikelnummer),                                          // BT-155
      el('ram:Name', p.bezeichnung)),                                                       // BT-153
    grp('ram:SpecifiedLineTradeAgreement',
      grp('ram:GrossPriceProductTradePrice',
        el('ram:ChargeAmount', betrag(p.bruttopreis)),                                      // BT-148
        p.preisnachlass > 0 && grp('ram:AppliedTradeAllowanceCharge',
          indikator(false),
          el('ram:ActualAmount', betrag(p.preisnachlass)))),                               // BT-147
      grp('ram:NetPriceProductTradePrice', el('ram:ChargeAmount', betrag(p.nettopreis)))), // BT-146
    grp('ram:SpecifiedLineTradeDelivery', el('ram:BilledQuantity', String(p.menge), { unitCode: 'H87' })), // BT-129/130
    grp('ram:SpecifiedLineTradeSettlement',
      steuer(m),                                                                            // BT-151/152
      grp('ram:SpecifiedTradeSettlementLineMonetarySummation',
        el('ram:LineTotalAmount', betrag(p.nettobetrag)))),                                 // BT-131
  );
}

function partei(name, { id, name: firmenname, kontakt, adresse, email, steuer: steuerIds = [] }) {
  return grp(name,
    el('ram:ID', id),
    el('ram:Name', firmenname),
    kontakt && grp('ram:DefinedTradeContact',
      el('ram:PersonName', kontakt.name),
      kontakt.telefon && grp('ram:TelephoneUniversalCommunication', el('ram:CompleteNumber', kontakt.telefon)),
      kontakt.email && grp('ram:EmailURIUniversalCommunication', el('ram:URIID', kontakt.email))),
    grp('ram:PostalTradeAddress',
      el('ram:PostcodeCode', adresse.plz),
      el('ram:LineOne', adresse.strasse),
      el('ram:CityName', adresse.ort),
      el('ram:CountryID', adresse.land)),
    email && grp('ram:URIUniversalCommunication', el('ram:URIID', email, { schemeID: 'EM' })),
    ...steuerIds.filter(([, wert]) => wert).map(([scheme, wert]) =>
      grp('ram:SpecifiedTaxRegistration', el('ram:ID', wert, { schemeID: scheme }))),
  );
}

function toCII(m) {
  const v = m.verkaeufer;
  const k = m.kaeufer;
  const s = m.summen;

  const xml = grp('rsm:CrossIndustryInvoice',
    grp('rsm:ExchangedDocumentContext',
      grp('ram:BusinessProcessSpecifiedDocumentContextParameter', el('ram:ID', GESCHAEFTSPROZESS)), // BT-23
      grp('ram:GuidelineSpecifiedDocumentContextParameter', el('ram:ID', m.guideline))),    // BT-24
    grp('rsm:ExchangedDocument',
      el('ram:ID', m.nummer),                                                               // BT-1
      el('ram:TypeCode', m.typCode),                                                        // BT-3
      grp('ram:IssueDateTime', datum102(m.datum)),                                           // BT-2
      ...m.hinweise.map((h) => grp('ram:IncludedNote', el('ram:Content', h)))),             // BT-22
    grp('rsm:SupplyChainTradeTransaction',
      ...m.positionen.map((p) => position(m, p)),
      grp('ram:ApplicableHeaderTradeAgreement',
        el('ram:BuyerReference', m.kaeuferReferenz),                                        // BT-10
        partei('ram:SellerTradeParty', {
          // BT-29: ohne USt-IdNr. verlangt BR-CO-26 eine Verkäuferkennung – die Steuernummer dient als solche
          id: v.ustIdNr ? '' : v.steuernummer,
          name: v.firma,                                                                    // BT-27
          kontakt: { name: v.name, telefon: v.telefon, email: v.email },                    // BG-6
          adresse: v,                                                                       // BG-5
          email: v.email,                                                                   // BT-34
          steuer: [['FC', v.steuernummer], ['VA', v.ustIdNr]],                              // BT-32 / BT-31
        }),
        partei('ram:BuyerTradeParty', {
          id: k.kundennummer,                                                               // BT-46
          name: k.name,                                                                     // BT-44
          adresse: k,                                                                       // BG-8
          email: k.email,                                                                   // BT-49
          steuer: [['VA', k.ustIdNr]],                                                      // BT-48
        })),
      grp('ram:ApplicableHeaderTradeDelivery',
        grp('ram:ActualDeliverySupplyChainEvent', grp('ram:OccurrenceDateTime', datum102(m.lieferdatum)))), // BT-72
      grp('ram:ApplicableHeaderTradeSettlement',
        el('ram:PaymentReference', m.zahlung.verwendungszweck),                             // BT-83
        el('ram:InvoiceCurrencyCode', m.waehrung),                                          // BT-5
        grp('ram:SpecifiedTradeSettlementPaymentMeans',
          el('ram:TypeCode', m.zahlung.code),                                               // BT-81
          grp('ram:PayeePartyCreditorFinancialAccount',
            el('ram:IBANID', m.zahlung.iban),                                               // BT-84
            el('ram:AccountName', m.zahlung.kontoinhaber)),                                 // BT-85
          m.zahlung.bic && grp('ram:PayeeSpecifiedCreditorFinancialInstitution',
            el('ram:BICID', m.zahlung.bic))),                                               // BT-86
        steuer(m, { mitBetrag: true, basis: s.netto }),                                     // BG-23
        m.leistungszeitraum && grp('ram:BillingSpecifiedPeriod',                            // BG-14
          grp('ram:StartDateTime', datum102(m.leistungszeitraum.von)),
          grp('ram:EndDateTime', datum102(m.leistungszeitraum.bis))),
        ...m.nachlaesse.map((n) => grp('ram:SpecifiedTradeAllowanceCharge',                // BG-20
          indikator(false),
          el('ram:CalculationPercent', n.prozent.toFixed(2)),                               // BT-94
          el('ram:BasisAmount', betrag(n.basis)),                                           // BT-93
          el('ram:ActualAmount', betrag(n.betrag)),                                         // BT-92
          el('ram:ReasonCode', n.grundCode),                                                // BT-98
          el('ram:Reason', n.grund),                                                        // BT-97
          grp('ram:CategoryTradeTax',
            el('ram:TypeCode', 'VAT'),
            el('ram:CategoryCode', m.steuer.kategorie),
            el('ram:RateApplicablePercent', String(m.steuer.satz))))),
        grp('ram:SpecifiedTradePaymentTerms', el('ram:Description', m.zahlung.bedingungen)), // BT-20
        grp('ram:SpecifiedTradeSettlementHeaderMonetarySummation',
          el('ram:LineTotalAmount', betrag(s.positionen)),                                  // BT-106
          m.nachlaesse.length > 0 && el('ram:AllowanceTotalAmount', betrag(s.nachlaesse)),  // BT-107
          el('ram:TaxBasisTotalAmount', betrag(s.netto)),                                   // BT-109
          el('ram:TaxTotalAmount', betrag(s.steuer), { currencyID: m.waehrung }),           // BT-110
          el('ram:GrandTotalAmount', betrag(s.brutto)),                                     // BT-112
          el('ram:DuePayableAmount', betrag(s.zahlbetrag))))),                              // BT-115
  );

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml.replace('<rsm:CrossIndustryInvoice>',
    '<rsm:CrossIndustryInvoice'
    + ' xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
    + ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"'
    + ' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"'
    + ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">');
}

module.exports = { toCII };
