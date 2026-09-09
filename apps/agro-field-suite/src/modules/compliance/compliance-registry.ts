import { CheckRegistry, coreCheckRegistry, type CheckSpec } from "@agrogea/tools";

/**
 * Registro delle schede di compliance dell'applicazione: il catalogo del core
 * più il **punto di innesto** per le schede fornite da plugin esterni.
 *
 * ## Perché l'innesto esiste già ma non carica nulla
 *
 * I disciplinari DOP/DOCG/IGP e di consorzio restano **fuori** da questo
 * repository: ognuno ha il proprio disciplinare, cambia con tempi suoi e
 * riguarda una manciata di aziende. Metterli qui significherebbe far crescere
 * il core di regole che il 99% degli utenti non userà mai, e legarne
 * l'aggiornamento al rilascio dell'applicazione.
 *
 * Vivranno quindi in plugin scaricabili, in repo separate. La giuntura per
 * caricarli **esiste già** lato GeoLibre e non va reinventata:
 *   * `GeoLibreExternalPluginManifest` (`@geolibre/plugins`, `types.ts`)
 *     descrive id, nome, versione ed entry point del plugin;
 *   * `isAllowedPluginManifestUrl` (`@geolibre/core`, `project.ts`) impone la
 *     regola di schema: **solo HTTPS**, o HTTP su loopback per lo sviluppo. È
 *     lo stesso vincolo che il dialogo Impostazioni e il caricamento di un file
 *     di progetto applicano, e vale perché da un manifest si arriva a codice
 *     scaricato ed eseguito.
 *
 * In questa fase **non si carica alcun plugin**: qui c'è solo la funzione con
 * cui un plugin, una volta caricato da quel percorso, registra le proprie
 * schede. Fermarsi qui è deliberato — un sistema di plugin a metà è peggio di
 * nessun sistema di plugin.
 */

let registry: CheckRegistry | null = null;

/** Registro condiviso dell'applicazione (catalogo core + schede di plugin). */
export function complianceRegistry(): CheckRegistry {
  if (!registry) registry = coreCheckRegistry();
  return registry;
}

/**
 * Registra una scheda fornita da un plugin. Un id già presente viene rifiutato
 * dal registro invece di sovrascrivere: una scheda di plugin che rimpiazzasse
 * in silenzio una del core cambierebbe il significato di un esito che l'utente
 * mostra a terzi.
 *
 * @throws se l'id è già registrato.
 */
export function registerComplianceCheck(spec: CheckSpec): void {
  complianceRegistry().register(spec, "plugin");
}

/** Rimuove una scheda di plugin (scarico del plugin). Le core non si tolgono. */
export function unregisterComplianceCheck(id: string): boolean {
  return complianceRegistry().unregister(id);
}

/** Solo per i test: riporta il registro al catalogo del core. */
export function resetComplianceRegistry(): void {
  registry = null;
}
