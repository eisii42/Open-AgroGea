import { type RefObject, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  TRANSLATED_ATTRIBUTES,
  translateNativeSubtree,
} from "../lib/native-map-i18n";

/**
 * Tiene tradotti i controlli mappa nativi (righello, gestore livelli) dentro il
 * contenitore della mappa.
 *
 * I due controlli riscrivono il proprio DOM a ogni apertura di pannello, cambio
 * di modalità o aggiunta di livello: non basta una passata all'avvio. Un
 * `MutationObserver` sul contenitore ritraduce solo ciò che è cambiato; le
 * nostre stesse scritture non innescano un ciclo infinito perché una stringa
 * già tradotta non è più nel dizionario (che è inglese→italiano) e la passata
 * successiva non trova nulla da fare.
 *
 * NON è legato al `mapReady` della dashboard: quello dipende dall’evento
 * `load` di MapLibre, che offline (o con la basemap irraggiungibile) non arriva
 * mai — e i controlli, che invece ci sono, resterebbero in inglese.
 *
 * Vedi `lib/native-map-i18n.ts` per il perché di questo approccio.
 */
export function useNativeMapI18n(
  containerRef: RefObject<HTMLElement | null>,
): void {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scheduled = 0;
    const pending: Node[] = [];

    const flush = () => {
      scheduled = 0;
      const nodes = pending.splice(0, pending.length);
      // Nodo staccato dal documento nel frattempo: tradurlo non serve a nulla.
      for (const node of nodes) {
        if (node.isConnected) translateNativeSubtree(node, t);
      }
    };

    const schedule = (node: Node) => {
      pending.push(node);
      if (scheduled) return;
      scheduled = window.setTimeout(flush, 0);
    };

    // Passata iniziale: i controlli montati prima dell'osservatore.
    translateNativeSubtree(container, t);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) schedule(node);
        } else if (record.target) {
          schedule(record.target);
        }
      }
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES],
    });

    return () => {
      observer.disconnect();
      if (scheduled) window.clearTimeout(scheduled);
    };
    // `i18n.language` nelle dipendenze: al cambio lingua si ritraduce da capo
    // (le stringhe già tradotte non tornano indietro, ma i pannelli riaperti
    // ripartono comunque dall'inglese del controllo nativo).
  }, [containerRef, t, i18n.language]);
}
