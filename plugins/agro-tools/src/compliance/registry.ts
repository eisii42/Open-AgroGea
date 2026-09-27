import type { CheckSpec } from "./check-types";

/**
 * Catalogo delle schede: data-driven per paese ed estendibile da plugin.
 *
 * ## Perché un registro e non un array esportato
 *
 * Due ragioni, entrambe pratiche:
 *   * **il set applicabile dipende dal paese dell'azienda**. La BCAA italiana
 *     non è quella francese: la stessa numerazione (BCAA 6) nasconde soglie e
 *     periodi sensibili diversi, e un catalogo unico costringerebbe a
 *     if-country dentro le schede — cioè nel posto peggiore;
 *   * **i plugin devono poter aggiungere schede senza toccare il core**. I
 *     disciplinari DOP/DOCG/IGP resteranno fuori da questo repository (uno per
 *     consorzio, in repo separate e più manutenibili): qui c'è solo l'innesto,
 *     e in questa fase NON viene caricato alcun plugin.
 *
 * La giuntura che i plugin useranno esiste già lato GeoLibre
 * (`GeoLibreExternalPluginManifest` in `@geolibre/plugins`, con la regola di
 * schema di `isAllowedPluginManifestUrl`: solo HTTPS, o HTTP su loopback in
 * sviluppo). Un plugin caricato da lì chiama {@link CheckRegistry.register}
 * sull'istanza esposta dal modulo Compliance dell'app.
 */
export class CheckRegistry {
  private readonly specs = new Map<string, CheckSpec>();
  private readonly sources = new Map<string, "core" | "plugin">();

  constructor(specs: readonly CheckSpec[] = []) {
    for (const spec of specs) this.register(spec, "core");
  }

  /**
   * Registra una scheda. Un id già presente viene RIFIUTATO invece di essere
   * sovrascritto: una scheda di plugin che rimpiazzasse silenziosamente una
   * scheda del core cambierebbe il significato di un esito senza che nessuno se
   * ne accorga — e gli esiti qui finiscono in un export che l'utente mostra a
   * terzi.
   */
  register(spec: CheckSpec, source: "core" | "plugin" = "plugin"): void {
    if (this.specs.has(spec.id)) {
      throw new Error(
        `Scheda di compliance duplicata: "${spec.id}" è già registrata da ${this.sources.get(spec.id)}.`,
      );
    }
    this.specs.set(spec.id, spec);
    this.sources.set(spec.id, source);
  }

  /** Rimuove una scheda di plugin (scarico del plugin). Le core non si tolgono. */
  unregister(id: string): boolean {
    if (this.sources.get(id) === "core") {
      throw new Error(`La scheda "${id}" è del core e non può essere rimossa.`);
    }
    this.sources.delete(id);
    return this.specs.delete(id);
  }

  get(id: string): CheckSpec | null {
    return this.specs.get(id) ?? null;
  }

  sourceOf(id: string): "core" | "plugin" | null {
    return this.sources.get(id) ?? null;
  }

  /**
   * Schede applicabili, nell'ordine di registrazione. Senza `country` torna
   * tutto il catalogo; con un paese restano le schede unionali (`"*"`) e quelle
   * che dichiarano quel paese.
   */
  list(options: { country?: string } = {}): CheckSpec[] {
    const country = options.country?.toUpperCase();
    return [...this.specs.values()].filter((spec) => {
      if (!country) return true;
      const countries = spec.reference.countries;
      return countries === "*" || countries.includes(country);
    });
  }

  /** Indici (e quindi bande) richiesti da un insieme di schede, deduplicati. */
  requiredIndices(specs: readonly CheckSpec[] = this.list()): string[] {
    const out = new Set<string>();
    for (const spec of specs) {
      for (const index of spec.requires.indices) out.add(index);
    }
    return [...out];
  }

  /**
   * Anni di archivio richiesti dal set: è il numero da mostrare all'utente
   * PRIMA di lanciare un'analisi che scarica scene storiche, insieme alle scene
   * stimate. La cache locale ne tiene 24 mesi: tutto ciò che va oltre è
   * recupero in rete, e ha un costo in tempo e traffico che va detto prima.
   */
  requiredArchiveYears(specs: readonly CheckSpec[] = this.list()): number {
    return specs.reduce((max, spec) => Math.max(max, spec.requires.archiveYears), 1);
  }
}
