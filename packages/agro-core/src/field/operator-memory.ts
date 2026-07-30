/**
 * Memoria per-device dell'ultimo operatore usato (name, codice fiscale,
 * patentino/abilitazione fitosanitari): non è un dato di una singola
 * operation o task — è CHI sta usando questo dispositivo. Condivisa fra il
 * form del Quaderno (`OperationForm`) e la Pianificazione Task (`TaskForm`)
 * così l'operatore non la ridigita a ogni form, ed è la fonte che il motore
 * di completezza (`task-completeness.ts`) usa per sapere se il patentino è
 * già noto quando valuta una task ancora da pianificare (`planned_tasks` non
 * ha una colonna propria per il patentino: è un dato dell'operatore/
 * dispositivo, non della singola lavorazione — niente migrazione di schema).
 *
 * Persistita in `localStorage` (device-local, mai sincronizzata): stesso
 * pattern di `field/settings.ts`/`field/theme.ts`.
 */

const OPERATOR_MEMORY_KEY = "agrogea.last_operator";

export interface OperatorMemory {
  name?: string;
  taxCode?: string;
  license?: string;
}

export function loadOperatorMemory(): OperatorMemory {
  try {
    const raw = globalThis.localStorage?.getItem(OPERATOR_MEMORY_KEY);
    return raw ? (JSON.parse(raw) as OperatorMemory) : {};
  } catch {
    return {};
  }
}

export function persistOperatorMemory(memory: OperatorMemory): void {
  try {
    globalThis.localStorage?.setItem(OPERATOR_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // storage non available: la memoria resta di sessione.
  }
}
