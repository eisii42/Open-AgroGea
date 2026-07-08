import type { ProductCategory, ProductLot, Product } from "../types";

/**
 * Motore PURO del Magazzino (0.2.0): CUMP (Costo Unitario Medio Ponderato,
 * media ponderata mobile), stato di scadenza dei lots e validazione per
 * categoria dell'anagrafica products. Nessun accesso al DB: le funzioni sono
 * usate dal DAL (`dal-warehouse.ts`) dentro le transazioni e dalla UI per la
 * validazione dei form (stesso pattern di `pan-validation.ts`).
 */

/** Soglia default (giorni) per l'alert "lotto in scadenza imminente". */
export const EXPIRY_WARNING_DAYS_DEFAULT = 30;

/**
 * CUMP dopo un carico: media ponderata tra la stock complessiva esistente
 * (valorizzata al CUMP corrente) e la quantità caricata (al costo di carico).
 * Con stock totale nulla o negativa il CUMP riparte dal costo di carico.
 * Arrotondato a 4 decimali (precisione della colonna `avg_unit_cost`).
 */
export function cumpAfterInbound(
  existingStock: number,
  cumpCorrente: number,
  quantitaCaricata: number,
  costoCarico: number,
): number {
  if (!(quantitaCaricata > 0)) return cumpCorrente;
  const base = existingStock > 0 ? existingStock : 0;
  const totale = base + quantitaCaricata;
  const cump = (base * cumpCorrente + quantitaCaricata * costoCarico) / totale;
  return Math.round(cump * 10000) / 10000;
}

/** Stato di scadenza di un lot rispetto a una data di riferimento. */
export type LotExpiryStatus = "valid" | "expiring" | "expired";

/**
 * Classifica la scadenza di un lot: `expired` se la data è passata,
 * `expiring` se cade entro `warningDays` giorni, `valid` altrimenti (o senza
 * scadenza). Il confronto è per GIORNO di calendario (un lot che scade oggi
 * è ancora utilizzabile). Accetta sia la stringa ISO del tipo di dominio sia
 * il `Date` che PGlite può restituire per le colonne `date`.
 */
export function expiryStatus(
  expiresAt: string | Date | null,
  riferimento: Date = new Date(),
  warningDays: number = EXPIRY_WARNING_DAYS_DEFAULT,
): LotExpiryStatus {
  if (!expiresAt) return "valid";
  // Il Date di PGlite è a mezzanotte LOCALE: si riformatta con i componenti
  // locali (toISOString slitterebbe di un giorno nei fusi positivi).
  const giorno =
    expiresAt instanceof Date
      ? `${expiresAt.getFullYear()}-${String(expiresAt.getMonth() + 1).padStart(2, "0")}-${String(expiresAt.getDate()).padStart(2, "0")}`
      : expiresAt.slice(0, 10);
  const scadenza = new Date(`${giorno}T23:59:59.999`);
  if (Number.isNaN(scadenza.getTime())) return "valid";
  if (scadenza.getTime() < riferimento.getTime()) return "expired";
  const soglia = new Date(riferimento);
  soglia.setDate(soglia.getDate() + warningDays);
  return scadenza.getTime() <= soglia.getTime() ? "expiring" : "valid";
}

/** true se il lot è scaduto (uso BLOCCATO nello issue, DAL + UI). */
export function lotExpired(
  lot: Pick<ProductLot, "expires_at">,
  riferimento: Date = new Date(),
): boolean {
  return expiryStatus(lot.expires_at, riferimento) === "expired";
}

/** Errore di validazione dell'anagrafica product (chiave i18n come la PAN). */
export interface ProductValidationError {
  field: string;
  messageKey: string;
}

/** Bozza di product in ingresso dal form (campi della categoria inclusi). */
export type ProductDraft = Pick<Product, "category" | "name" | "unit"> &
  Partial<
    Pick<
      Product,
      | "registration_number"
      | "active_substance"
      | "npk_n"
      | "npk_p"
      | "npk_k"
      | "uma_code"
      | "supplier"
    >
  >;

const isBlank = (v: string | null | undefined) => !v || v.trim() === "";
const isPct = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * Validazione RIGIDA per categoria (Design 0.2.0 §4): name e unità sempre
 * obbligatori; agrofarmaci → n. registrazione PAN; concimi → titoli N-P-K in
 * percentuale (0–100); carburante → codice assegnazione UMA. Le sementi non
 * hanno campi aggiuntivi obbligatori.
 */
export function validateProduct(
  draft: ProductDraft,
): ProductValidationError[] {
  const errors: ProductValidationError[] = [];
  if (isBlank(draft.name)) {
    errors.push({ field: "name", messageKey: "warehouse.validation.required" });
  }
  if (isBlank(draft.unit)) {
    errors.push({ field: "unit", messageKey: "warehouse.validation.required" });
  }
  const byCategory: Record<ProductCategory, () => void> = {
    phytosanitary: () => {
      if (isBlank(draft.registration_number)) {
        errors.push({
          field: "registration_number",
          messageKey: "warehouse.validation.required",
        });
      }
    },
    fertilizer: () => {
      for (const field of ["npk_n", "npk_p", "npk_k"] as const) {
        if (!isPct(draft[field])) {
          errors.push({
            field,
            messageKey: "warehouse.validation.npkPercent",
          });
        }
      }
    },
    seed: () => {},
    fuel: () => {
      if (isBlank(draft.uma_code)) {
        errors.push({
          field: "uma_code",
          messageKey: "warehouse.validation.required",
        });
      }
    },
    other: () => {},
  };
  byCategory[draft.category]?.();
  return errors;
}

/**
 * Mappa tipo operation del Quaderno → categoria di warehouse pertinente per
 * lo issue (i tipi senza consumo di product non hanno categoria).
 */
export function categoryForOperation(
  operationType: string,
): ProductCategory | null {
  switch (operationType) {
    case "phytosanitary":
      return "phytosanitary";
    case "fertilization":
      return "fertilizer";
    case "sowing":
      return "seed";
    default:
      return null;
  }
}
