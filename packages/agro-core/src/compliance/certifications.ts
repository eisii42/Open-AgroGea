import type {
  CertificationScheme,
  Company,
  OperatorCertification,
  PlotCampaign,
  ProductionRegime,
} from "../types";

/**
 * Certificazione dell'OPERATORE e regime di produzione dell'ANNATA: logica PURA
 * (niente DB, niente store, niente React), condivisa da anagrafica, scheda
 * coltura, badge di compliance e — dalla fase 2 — dal motore biologico.
 *
 * Perché due concetti separati e non un `certifications: string[]`
 * sull'azienda (la colonna deprecata dalla v24):
 *
 *   * la CERTIFICAZIONE è dell'operatore. È un organismo di controllo a
 *     rilasciarla all'azienda, con un numero di certificato e una validità:
 *     senza quella struttura non è verificabile né esportabile;
 *   * il REGIME è dell'appezzamento PER ANNATA. Un'azienda certificata bio può
 *     avere corpi aziendali in conversione e altri ancora convenzionali, e la
 *     storia va conservata: "bio dal 2024" non si può scrivere su una riga
 *     unica dell'appezzamento senza cancellare il 2023.
 *
 * Le date sono giorni ISO `YYYY-MM-DD` (colonne `date`, normalizzate dal DAL),
 * confrontabili lessicograficamente senza costruire `Date` — che introdurrebbe
 * il fuso orario in un dato che non ne ha.
 */

/** Schemi di certificazione gestiti dalla UI. Per ora solo il biologico. */
export const CERTIFICATION_SCHEMES: readonly CertificationScheme[] = ["organic"];

/** Regimi di produzione dichiarabili per l'annata, nell'ordine della UI. */
export const PRODUCTION_REGIMES: readonly ProductionRegime[] = [
  "conventional",
  "in_conversion",
  "organic",
  "integrated",
];

/**
 * Durata della conversione al biologico (Reg. UE 2018/848, All. II parte I
 * punto 1.7): 24 mesi prima della semina per le colture annuali, 36 mesi prima
 * del raccolto per le perenni. Sono i due valori che il motore biologico della
 * fase 2 userà per dire se un raccolto è certificabile.
 */
export const ORGANIC_CONVERSION_MONTHS = { annual: 24, perennial: 36 } as const;

/** Type guard sul valore persistito di `plots_campaign.production_regime`. */
export function isProductionRegime(value: unknown): value is ProductionRegime {
  return (
    typeof value === "string" &&
    (PRODUCTION_REGIMES as readonly string[]).includes(value)
  );
}

/** Il regime vale come biologico (certificato o in conversione)? */
export function isOrganicRegime(regime: ProductionRegime | null): boolean {
  return regime === "organic" || regime === "in_conversion";
}

/** Stringa non vuota, o `null`. Normalizza i campi liberi del form. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Legge `companies.operator_certifications` in modo DIFENSIVO: è jsonb, quindi
 * può contenere qualunque cosa (file manomesso, backup di una versione futura,
 * riga scritta a mano). Ciò che non è un oggetto con uno `scheme` utile viene
 * scartato invece di propagarsi come dato mezzo valido.
 */
export function readOperatorCertifications(
  company: Pick<Company, "operator_certifications"> | null | undefined,
): OperatorCertification[] {
  const raw: unknown = company?.operator_certifications;
  if (!Array.isArray(raw)) return [];
  const out: OperatorCertification[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const scheme = trimmedOrNull(record["scheme"]);
    if (!scheme) continue;
    out.push({
      scheme,
      operator_code: trimmedOrNull(record["operator_code"]),
      control_body: trimmedOrNull(record["control_body"]),
      certificate_number: trimmedOrNull(record["certificate_number"]),
      valid_from: trimmedOrNull(record["valid_from"]),
      valid_to: trimmedOrNull(record["valid_to"]),
    });
  }
  return out;
}

/** La certificazione di uno schema, se dichiarata. */
export function findOperatorCertification(
  company: Pick<Company, "operator_certifications"> | null | undefined,
  scheme: CertificationScheme,
): OperatorCertification | null {
  return (
    readOperatorCertifications(company).find((c) => c.scheme === scheme) ?? null
  );
}

/** Una certificazione vuota (nessun campo compilato) è "non dichiarata". */
export function isEmptyCertification(cert: OperatorCertification): boolean {
  return (
    !cert.operator_code &&
    !cert.control_body &&
    !cert.certificate_number &&
    !cert.valid_from &&
    !cert.valid_to
  );
}

/**
 * Sostituisce (o rimuove, con `entry` nullo o vuoto) la certificazione di UNO
 * schema, lasciando intatte le altre: la UI ne modifica una alla volta e non
 * deve poter cancellare gli schemi che non conosce.
 */
export function withOperatorCertification(
  current: readonly OperatorCertification[],
  scheme: CertificationScheme,
  entry: OperatorCertification | null,
): OperatorCertification[] {
  const others = current.filter((c) => c.scheme !== scheme);
  if (!entry || isEmptyCertification(entry)) return others;
  return [...others, { ...entry, scheme }];
}

/**
 * La certificazione è in corso di validità al giorno indicato? Gli estremi sono
 * inclusi; un estremo mancante non taglia da quel lato (un certificato senza
 * scadenza dichiarata non è scaduto).
 */
export function isCertificationValid(
  cert: OperatorCertification,
  onIsoDay: string,
): boolean {
  const day = onIsoDay.slice(0, 10);
  if (cert.valid_from && day < cert.valid_from.slice(0, 10)) return false;
  if (cert.valid_to && day > cert.valid_to.slice(0, 10)) return false;
  return true;
}

/**
 * Fine del periodo di conversione al biologico a partire da `regime_since`.
 * `null` se la data d'inizio manca: un periodo di conversione senza inizio non
 * si inventa, si dichiara mancante (ed è il motivo per cui la fase 2 potrà
 * rispondere "non decidibile" invece di un verdetto falso).
 */
export function conversionEndsOn(
  campaign: Pick<PlotCampaign, "regime_since">,
  crop: "annual" | "perennial",
): string | null {
  const since = campaign.regime_since?.slice(0, 10);
  if (!since) return null;
  const [year, month, day] = since.split("-").map(Number);
  if (!year || !month || !day) return null;
  // UTC: i giorni ISO non hanno fuso, e `Date.UTC` gestisce da solo il
  // trabocco dei mesi (31 gennaio + 24 mesi resta 31 gennaio).
  const end = new Date(
    Date.UTC(year, month - 1 + ORGANIC_CONVERSION_MONTHS[crop], day),
  );
  return end.toISOString().slice(0, 10);
}
