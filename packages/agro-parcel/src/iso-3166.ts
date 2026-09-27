/**
 * ISO 3166-1 alpha-2 — i codici paese ufficialmente assegnati, come DATO.
 *
 * Due consumatori, in due pacchetti: il `country` del contratto {@link ./parcel}
 * e dei record di catalogo, e il `CountryCode` della Country Resolution in
 * `@agrogea/core`. Sta nel pacchetto FOGLIA perché entrambi possano leggerlo
 * senza dipendenze incrociate, e perché aggiungere un mercato non significhi
 * modificare a mano un'unione di tipi.
 *
 * L'elenco è volutamente "stupido": nessun name, nessuna traduzione, nessun
 * raggruppamento, solo i codici. I nomi per esteso (e le loro varianti
 * localizzate) restano un fatto di UI/i18n.
 *
 * Nota su `EU`: NON è un codice ufficialmente assegnato — è "exceptionally
 * reserved" in ISO 3166-1 — e proprio per questo resta libero come sentinella
 * interna del fallback internazionale, senza mai collidere con un paese vero.
 * Per lo stesso motivo i codici user-assigned (`AA`, `QM`–`QZ`, `XA`–`XZ`, `ZZ`)
 * non sono qui: una stringa così in anagrafica è un errore di battitura, non un
 * paese, e {@link isIsoAlpha2} deve poterla respingere.
 */

/** Codici ISO 3166-1 alpha-2 ufficialmente assegnati (249). */
export const ISO_3166_1_ALPHA_2 = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR",
  "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL",
  "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM",
  "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM",
  "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM",
  "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW",
  "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR",
  "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK",
  "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN",
  "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;

/** Un codice ISO 3166-1 alpha-2 ufficialmente assegnato. */
export type IsoAlpha2 = (typeof ISO_3166_1_ALPHA_2)[number];

/** Indice per la verifica in tempo costante (l'elenco è statico). */
const ISO_CODES: ReadonlySet<string> = new Set(ISO_3166_1_ALPHA_2);

/**
 * True se la stringa è un codice ISO 3166-1 alpha-2 assegnato. Si aspetta il
 * codice GIÀ normalizzato (trim + maiuscolo): la normalizzazione dell'input
 * utente è responsabilità del chiamante.
 */
export function isIsoAlpha2(raw: string): raw is IsoAlpha2 {
  return ISO_CODES.has(raw);
}
