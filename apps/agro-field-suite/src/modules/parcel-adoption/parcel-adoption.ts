/**
 * Logica PURA del modulo di adozione delle particelle: nessun React, nessuna
 * rete, nessuna mappa. Sta a parte dal pannello perché è la parte che va
 * verificata — quale fonte interrogare, che cosa mostrare di una candidata,
 * come si comporta un riquadro degenere — mentre il pannello è solo il vestito.
 */
import type { BBox, Parcel, ParcelSourceRecord, ReferenceUnitType } from "@agrogea/parcel";
import { isSourcedParcel } from "@agrogea/parcel";

/**
 * Chiave i18n che spiega che cosa si sta adottando. Non è una decorazione: un
 * `physical_block` tedesco può contenere più appezzamenti coltivati diversi e
 * una particella catastale italiana può ospitare due colture, mentre una
 * `agricultural_parcel` è già l'unità colturale. L'utente deve saperlo PRIMA di
 * adottare, non scoprirlo quando i conti non tornano.
 */
export type ReferenceUnitTypeKey = `parcelAdoption.unitType.${ReferenceUnitType}`;

export function referenceUnitTypeKey(
  type: ReferenceUnitType,
): ReferenceUnitTypeKey {
  // Tipo letterale e non `string`: le chiavi di `t()` sono verificate contro
  // en.json, quindi rinominare una voce del catalogo i18n rompe il typecheck
  // invece di produrre una stringa grezza a schermo.
  return `parcelAdoption.unitType.${type}`;
}

/** Riquadro visibile della mappa, nell'ordine di {@link BBox}. */
export interface ViewportBounds {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

/** Converte i confini della mappa nel riquadro atteso dagli adapter. */
export function boundsToBBox(bounds: ViewportBounds): BBox {
  return [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ];
}

/**
 * True se il riquadro è troppo ampio per un'interrogazione sensata. Una vista
 * continentale produrrebbe centinaia di migliaia di geometrie: meglio chiedere
 * all'utente di avvicinarsi che scaricare mezzo paese e troncare.
 */
export const MAX_QUERY_SPAN_DEG = 0.5;

export function isViewportTooWide(bbox: BBox): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return maxLon - minLon > MAX_QUERY_SPAN_DEG || maxLat - minLat > MAX_QUERY_SPAN_DEG;
}

/** Riepilogo di una candidata, pronto per la lista. */
export interface CandidateSummary {
  /** Identificativo nativo, o una dicitura per il disegno manuale. */
  reference: string | null;
  /** Chiave i18n del tipo di unità di riferimento. */
  unitTypeKey: ReferenceUnitTypeKey;
  /** Superficie dichiarata dalla fonte in ettari, se pubblicata. */
  declaredArea: number | null;
  /** Codice coltura nella codifica della fonte. */
  nationalCropCode: string | null;
  /** Annata del dato. */
  validityYear: number | null;
}

/** Estrae da una candidata ciò che serve a decidere se adottarla. */
export function candidateSummary(parcel: Parcel): CandidateSummary {
  return {
    reference: isSourcedParcel(parcel) ? parcel.sourceId : null,
    unitTypeKey: referenceUnitTypeKey(parcel.referenceUnitType),
    declaredArea: parcel.declaredArea,
    nationalCropCode: parcel.nationalCropCode,
    validityYear: parcel.validityYear,
  };
}

/**
 * Nome proposto per l'appezzamento adottato. L'identificativo nativo è brutto
 * ma è l'unica cosa che distingue davvero due particelle vicine: si propone
 * quello e si lascia che l'utente lo cambi, invece di inventare un "Campo 3"
 * che domani non dirà nulla a nessuno.
 */
export function suggestedPlotName(parcel: Parcel, fallbackIndex: number): string {
  if (isSourcedParcel(parcel) && parcel.sourceId.trim() !== "") {
    return parcel.sourceId;
  }
  return `Plot ${fallbackIndex}`;
}

/**
 * Fonti proposte all'utente. Il catalogo si mostra INTERO, con la fonte
 * suggerita in cima: il paese dell'azienda preseleziona, non vincola. La sede
 * legale spesso non coincide coi terreni, e appezzamenti in paesi diversi sono
 * la norma sui confini — chi ha un campo oltreconfine deve poterlo raggiungere
 * senza cambiare l'anagrafica aziendale.
 */
export function orderSourcesForCountry(
  sources: readonly ParcelSourceRecord[],
  country: string | null,
): ParcelSourceRecord[] {
  if (!country) return [...sources];
  const prefix = country.toUpperCase();
  const matching = sources.filter((s) =>
    s.nuts.some((node) => node.toUpperCase().startsWith(prefix)),
  );
  const rest = sources.filter((s) => !matching.includes(s));
  return [...matching, ...rest];
}
