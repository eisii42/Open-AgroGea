/**
 * Sceglie l'adapter giusto per un record di catalogo.
 *
 * È l'unico punto in cui `accessType` si traduce in un'implementazione, ed è
 * volutamente uno `switch` esaustivo: quando si aggiungerà `atom`, `bulk` o
 * `gml`, il compilatore indicherà questo punto invece di lasciar passare in
 * silenzio una fonte che nessuno sa interrogare.
 *
 * Nota su cosa NON è configurabile qui: il modo di accesso è un fatto tecnico
 * del servizio, non una preferenza. Il paese, la licenza, gli attributi restano
 * tutti dato nel record.
 */
import { createOgcApiSource } from "./ogcapi-source";
import type { ParcelSource, ParcelSourceDeps } from "./source";
import type { ParcelSourceRecord } from "./source-record";
import { createWfsSource } from "./wfs-source";

/** Modi di accesso non ancora implementati (Fase 2 in avanti). */
export class UnsupportedAccessTypeError extends Error {
  constructor(
    readonly sourceId: string,
    readonly accessType: string,
  ) {
    super(
      `La fonte "${sourceId}" usa un modo di accesso non ancora supportato: "${accessType}".`,
    );
    this.name = "UnsupportedAccessTypeError";
  }
}

/**
 * Istanzia l'adapter per un record di catalogo. Lancia
 * {@link UnsupportedAccessTypeError} per i modi di accesso non ancora coperti:
 * un errore esplicito è preferibile a una fonte che restituisce sempre zero
 * particelle e sembra soltanto un'area senza dati.
 */
export function createParcelSource(
  record: ParcelSourceRecord,
  deps: ParcelSourceDeps,
): ParcelSource {
  switch (record.accessType) {
    case "wfs":
      return createWfsSource(record, deps);
    case "ogcapi":
      return createOgcApiSource(record, deps);
    case "atom":
    case "bulk":
    case "gml":
      throw new UnsupportedAccessTypeError(record.id, record.accessType);
  }
}
