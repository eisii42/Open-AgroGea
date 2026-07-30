import type { OperationType } from "@agrogea/core";
import { OPERATIONS, operationSpec } from "../field-logbook/OperationForm";

/**
 * Quali campi ha senso PIANIFICARE, per tipo di operation.
 *
 * DERIVATA dal registro del Quaderno di Campagna (`OPERATIONS`/`OpFieldSpec` in
 * `OperationForm`), non ricopiata: la pianificazione di una task e la
 * registrazione dell'operazione descrivono lo stesso lavoro, e devono chiedere
 * gli stessi dati. Se domani il Quaderno aggiunge l'avversità a un altro tipo,
 * o cambia la categoria di product della semina, il form delle task si adegua
 * da sé — senza che nessuno debba ricordarsi di allineare due elenchi.
 *
 * La differenza legittima è il MOMENTO: alcuni campi del Quaderno si conoscono
 * solo a lavoro fatto (ore macchina, volume reale della botte, quantità totale
 * sulla superficie percorsa) e non appartengono a una pianificazione. Sono
 * quelli che questa specifica scarta, ed è l'unica ragione per cui esiste
 * invece di usare `OpFieldSpec` direttamente.
 *
 * Filosofia: il meno possibile, ma completo. Un tipo mostra soltanto i campi
 * che gli servono; tutto ciò che è derivabile (dosi dalla ricetta, quantità
 * dalla superficie GPS, prodotto/registrazione dall'anagrafica) non viene
 * chiesto due volte.
 */
export interface TaskFieldSpec {
  /**
   * La miscela si esprime con una RICETTA (products + dose per ettaro): vale
   * per i soli tipi che nel Quaderno hanno un product di categoria
   * `phyto`/`fertilizer`. Gli altri tipi non hanno ricette.
   */
  recipe: boolean;
  /** Avversità/patogeno bersaglio, dalla lista rigorosa PAN (mai testo libero). */
  targetDisease: boolean;
  /** Semente scelta dall'anagrafica di Magazzino + dose (semina). */
  seedProduct: boolean;
  /** Tipo di lavorazione del terreno (lavorazione). */
  tillageType: boolean;
  /** Apporto irriguo pianificato + unità mm/hl (irrigazione). */
  irrigationAmount: boolean;
  /**
   * Patentino dell'operatore: solo dove il Quaderno lo pretende (fitosanitari).
   * Chiederlo altrove sarebbe rumore — e un campo in più da compilare.
   */
  licenseNumber: boolean;
}

const EMPTY_SPEC: TaskFieldSpec = {
  recipe: false,
  targetDisease: false,
  seedProduct: false,
  tillageType: false,
  irrigationAmount: false,
  licenseNumber: false,
};

/**
 * Tipi di operation pianificabili: quelli del registro del Quaderno, PIÙ
 * `harvest` (che nel Quaderno vive in un module a sé, `HarvestPanel`, e quindi
 * non compare in `OPERATIONS`). Derivato dal registro: aggiungere un tipo al
 * Quaderno lo rende pianificabile senza toccare questo file.
 */
export const TASK_OPERATION_TYPES: OperationType[] = [
  ...OPERATIONS.map((o) => o.type),
  "harvest",
];

/**
 * Specifica dei campi pianificabili per un tipo di operation.
 *
 * `harvest` non è nel registro del Quaderno e va gestito esplicitamente:
 * `operationSpec` ricadrebbe sul primo elemento (i fitosanitari) e la task
 * mostrerebbe avversità e ricetta per una raccolta. Una pianificazione di
 * raccolta non ha campi propri — appezzamento, data e operatore bastano.
 */
export function taskFieldSpec(type: OperationType | ""): TaskFieldSpec {
  if (type === "" || type === "harvest") return EMPTY_SPEC;
  const fields = operationSpec(type).fields;
  return {
    recipe: fields.product === "phyto" || fields.product === "fertilizer",
    targetDisease: fields.targetDisease === true,
    seedProduct: fields.product === "seed",
    tillageType: fields.tillageType === true,
    irrigationAmount: fields.irrigationAmount === true,
    licenseNumber: fields.licenseNumber === true,
  };
}
