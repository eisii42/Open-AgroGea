/**
 * Catalogo delle fonti di particelle e sua interrogazione per nodo NUTS.
 *
 * I record sono file JSON in `catalog/`, uno per fonte: si aggiunge una fonte
 * lasciando lì il suo file e citandolo qui sotto. Un file per fonte (invece di
 * un unico JSON con dentro tutto) perché la verifica live scrive `lastVerified`
 * sul singolo record: con un file solo, ogni controllo riscriverebbe l'intero
 * catalogo e ogni differenza sarebbe illeggibile.
 *
 * ## Le garanzie non vengono dai tipi
 *
 * TypeScript non può controllare il CONTENUTO di un JSON: l'`import` restituisce
 * tipi allargati (`string` al posto delle unioni chiuse), e l'asserzione qui
 * sotto è quindi inevitabile. A tenere onesto il catalogo è
 * {@link validateCatalog}, eseguito dalla suite di test: se un record è
 * malformato la CI si ferma. L'asserzione dichiara un fatto verificato altrove,
 * non lo dà per scontato.
 */
import nlBrpGewaspercelen from "./catalog/nl-brp-gewaspercelen.json";
import type { ParcelSourceRecord } from "./source-record";

/** Record grezzi, nell'ordine in cui il catalogo li propone. */
const RECORDS: readonly unknown[] = [nlBrpGewaspercelen];

/**
 * Il catalogo completo. Validato da `validateCatalog` nella suite di test —
 * vedi la nota sulle garanzie in testa al file.
 */
export const PARCEL_SOURCE_CATALOG =
  RECORDS as readonly ParcelSourceRecord[];

/** La fonte con quell'id, o `null` se il catalogo non la conosce. */
export function sourceById(id: string): ParcelSourceRecord | null {
  return PARCEL_SOURCE_CATALOG.find((source) => source.id === id) ?? null;
}

/**
 * True se il nodo `coverage` copre il nodo `nutsCode`. I codici NUTS sono
 * gerarchici e prefissati (`NL` → `NL3` → `NL32`), quindi la copertura si
 * eredita verso il basso: una fonte dichiarata su `"NL"` risponde anche per
 * `"NL32"`, mentre una dichiarata su `"NL32"` non risponde per tutta l'Olanda.
 *
 * Il confronto è su stringa intera-o-prefisso, mai su un troncamento arbitrario:
 * `"DE1"` copre `"DE11"` ma non `"DE2"`.
 */
export function nutsCovers(coverage: string, nutsCode: string): boolean {
  return nutsCode === coverage || nutsCode.startsWith(coverage);
}

/**
 * Le fonti che possono rispondere per il nodo dato, nell'ordine del catalogo.
 *
 * Serve al caso d'uso reale: l'utente guarda un punto sulla mappa, e vogliamo
 * sapere chi pubblica le particelle di quel posto. Un'azienda con campi in nodi
 * diversi — o in paesi diversi, che è la norma sui confini — interroga
 * semplicemente più volte, senza che nulla la vincoli a un solo nodo.
 */
export function sourcesCovering(
  nutsCode: string,
): readonly ParcelSourceRecord[] {
  return PARCEL_SOURCE_CATALOG.filter((source) =>
    source.nuts.some((coverage) => nutsCovers(coverage, nutsCode)),
  );
}
