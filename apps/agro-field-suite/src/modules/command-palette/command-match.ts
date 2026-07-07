/**
 * Matching dei comandi della Command Palette (Ctrl/Cmd+K).
 *
 * Logica PURA e deterministica (testabile sotto Node): filtra e ordina i comandi
 * in base alla query digitata, indipendente da React e dallo store.
 */

export type CategoriaComando = "azione" | "appezzamento";

export interface ComandoBase {
  id: string;
  titolo: string;
  sottotitolo?: string;
  /** Termini extra per il match (sinonimi, sigle). */
  paroleChiave?: string[];
  categoria: CategoriaComando;
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
  const titolo = normalizza(comando.titolo);
  const haystack = normalizza(
    [comando.titolo, comando.sottotitolo, ...(comando.paroleChiave ?? [])]
      .filter(Boolean)
      .join(" "),
  );

  let punteggio = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1; // AND: tutti i token devono esserci.
    if (titolo.startsWith(token)) punteggio += 3;
    else if (titolo.includes(token)) punteggio += 2;
    else punteggio += 1; // match solo su sottotitolo/parole chiave.
  }
  // Bonus se l'intera query è un prefisso del titolo (match "pieno").
  if (titolo.startsWith(tokens.join(" "))) punteggio += 2;
  return punteggio;
}

/**
 * Filtra e ordina i comandi per la query. Query vuota → tutti i comandi
 * nell'ordine originale (azioni prima, poi plots, come passati). Con
 * query → solo quelli che contengono TUTTI i token, ordinati per punteggio
 * decrescente; a parità, titolo più corto e poi ordine originale (stabile).
 */
export function filtraComandi<T extends ComandoBase>(
  comandi: T[],
  query: string,
): T[] {
  const q = normalizza(query);
  if (q === "") return [...comandi];
  const tokens = q.split(" ");

  return comandi
    .map((comando, indice) => ({
      comando,
      indice,
      punteggio: punteggioComando(comando, tokens),
    }))
    .filter((entry) => entry.punteggio >= 0)
    .sort((a, b) => {
      if (b.punteggio !== a.punteggio) return b.punteggio - a.punteggio;
      const lenDiff = a.comando.titolo.length - b.comando.titolo.length;
      if (lenDiff !== 0) return lenDiff;
      return a.indice - b.indice;
    })
    .map((entry) => entry.comando);
}
