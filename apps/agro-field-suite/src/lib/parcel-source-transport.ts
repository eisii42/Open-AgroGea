/**
 * Lato applicativo del trasporto delle fonti di particelle: sceglie la strada di
 * rete giusta per il runtime e compone le capacità che `@agrogea/parcel` si fa
 * iniettare.
 *
 * Due strade, stesso contratto — lo stesso schema già collaudato per i tile WMS
 * in `mapTileProxy.ts`:
 *
 *   * **Tauri** → comando nativo `agro_fetch_parcel_source`, che vive fuori dal
 *     sandbox CORS del webview e fa rispettare allow-list, blocco degli
 *     indirizzi privati e limite di concorrenza.
 *   * **Web/dev** → il proxy del dev server Vite, lo stesso middleware dei tile.
 *     Non ha le difese del comando nativo, e non deve averle: è un ambiente di
 *     sviluppo, non una superficie che raggiunge un utente.
 *
 * Gli host ammessi si derivano DAL CATALOGO e si registrano una volta sola: il
 * catalogo resta l'unica fonte di verità (nessun elenco duplicato in Rust che
 * scivolerebbe fuori sincrono), ma è il lato nativo a farlo rispettare.
 */
import { createProj4Reprojector, isTauriRuntime, tauriInvoke } from "@agrogea/core";
import {
  PARCEL_SOURCE_CATALOG,
  type ParcelFetch,
  type ParcelSourceDeps,
} from "@agrogea/parcel";

/** Middleware del dev server Vite, condiviso con il proxy dei tile WMS. */
const DEV_PROXY_PATH = "/__geolibre_wms_proxy";

/** Host di tutte le fonti del catalogo, senza duplicati. */
export function catalogHosts(): string[] {
  const hosts = new Set<string>();
  for (const source of PARCEL_SOURCE_CATALOG) {
    try {
      hosts.add(new URL(source.endpoint).host);
    } catch {
      // Un endpoint malformato è già respinto da `validateSourceRecord` in CI:
      // qui si ignora invece di impedire l'uso di tutte le altre fonti.
    }
  }
  return [...hosts];
}

/**
 * Registrazione una tantum dell'allow-list. Si conserva la promessa e non un
 * booleano, così due interrogazioni concorrenti al primo avvio non registrano
 * due volte né partono prima che la registrazione sia conclusa.
 */
let registration: Promise<void> | null = null;

function ensureHostsRegistered(): Promise<void> {
  registration ??= tauriInvoke<number>("agro_register_parcel_source_hosts", {
    hosts: catalogHosts(),
  }).then(
    () => undefined,
    (error: unknown) => {
      // Una registrazione fallita non va memorizzata: il tentativo successivo
      // deve poterci riprovare, altrimenti l'app resta senza fonti per sempre.
      registration = null;
      throw error;
    },
  );
  return registration;
}

/** Rifiuta se il segnale è già stato annullato, prima di aprire la rete. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Interrogazione annullata.", "AbortError");
  }
}

/**
 * Attende la richiesta, ma abbandona subito se il segnale scatta.
 *
 * Nota onesta: il comando nativo non si può interrompere a metà, quindi qui si
 * abbandona l'ATTESA, non la richiesta — che prosegue fino alla fine e solo
 * allora libera il suo posto nel semaforo. Per un'interrogazione di qualche
 * secondo è un compromesso accettabile; se un giorno serviranno download lunghi
 * e annullabili, dovrà essere il lato Rust a esporre un annullamento vero.
 */
function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Interrogazione annullata.", "AbortError")),
        { once: true },
      );
    }),
  ]);
}

/**
 * Recupero di un documento JSON da una fonte di particelle. È l'implementazione
 * di {@link ParcelFetch} che gli adapter ricevono iniettata.
 */
export const parcelSourceFetch: ParcelFetch = async (url, options) => {
  throwIfAborted(options?.signal);

  if (isTauriRuntime()) {
    await ensureHostsRegistered();
    throwIfAborted(options?.signal);
    const body = await withAbort(
      tauriInvoke<string>("agro_fetch_parcel_source", { url }),
      options?.signal,
    );
    return JSON.parse(body) as unknown;
  }

  const response = await fetch(
    `${DEV_PROXY_PATH}?url=${encodeURIComponent(url)}`,
    { signal: options?.signal },
  );
  if (!response.ok) {
    throw new Error(`La fonte ha risposto ${response.status}.`);
  }
  return (await response.json()) as unknown;
};

/**
 * Le capacità complete da passare agli adapter: recupero, riproiezione,
 * generazione degli identificativi e orologio. Sta qui — e non sparso nei punti
 * di chiamata — perché una particella acquisita da due schermate diverse deve
 * nascere identica.
 */
export function createParcelSourceDeps(): ParcelSourceDeps {
  return {
    fetch: parcelSourceFetch,
    reproject: createProj4Reprojector(),
    newId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
}
