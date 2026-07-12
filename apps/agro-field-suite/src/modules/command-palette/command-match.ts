/**
 * Matching dei comandi della Command Palette (Ctrl/Cmd+K).
 *
 * Logica PURA e deterministica (testabile sotto Node): filtra e ordina i comandi
 * in base alla query digitata, indipendente da React e dallo store.
 */

export type CommandCategory = "azione" | "appezzamento";

export interface ComandoBase {
  id: string;
  title: string;
  sottotitolo?: string;
  /** Termini extra per il match (sinonimi, sigle). */
  paroleChiave?: string[];
  category: CommandCategory;
}

/** Normalizza per il confronto: minuscolo, senza accenti né punteggiatura. */
export function normalizza(testo: string): string {
  return testo
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // segni diacritici combinanti
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function punteggioComando(comando: ComandoBase, tokens: string[]): number {
  const title = normalizza(comando.title);
  const haystack = normalizza(
    [comando.title, comando.sottotitolo, ...(comando.paroleChiave ?? [])]
      .filter(Boolean)
      .join(" "),
  );

  let punteggio = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1; // AND: tutti i token devono esserci.
    if (title.startsWith(token)) punteggio += 3;
    else if (title.includes(token)) punteggio += 2;
    else punteggio += 1; // match solo su sottotitolo/parole chiave.
  }
  // Bonus se l'intera query è un prefisso del title (match "pieno").
  if (title.startsWith(tokens.join(" "))) punteggio += 2;
  return punteggio;
}

/**
 * Filtra e ordina i comandi per la query. Query vuota → tutti i comandi
 * nell'ordine originale (azioni prima, poi plots, come passati). Con
 * query → solo quelli che contengono TUTTI i token, sorted per punteggio
 * decrescente; a parità, title più corto e poi ordine originale (stabile).
 */
export function filterCommands<T extends ComandoBase>(
  comandi: T[],
  query: string,
): T[] {
  const q = normalizza(query);
  if (q === "") return [...comandi];
  const tokens = q.split(" ");

  return comandi
    .map((comando, index) => ({
      comando,
      index,
      punteggio: punteggioComando(comando, tokens),
    }))
    .filter((entry) => entry.punteggio >= 0)
    .sort((a, b) => {
      if (b.punteggio !== a.punteggio) return b.punteggio - a.punteggio;
      const lenDiff = a.comando.title.length - b.comando.title.length;
      if (lenDiff !== 0) return lenDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.comando);
}
