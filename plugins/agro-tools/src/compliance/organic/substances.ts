/**
 * Dati di riferimento VERSIONATI dei mezzi tecnici ammessi in agricoltura
 * biologica.
 *
 * ## Perché sono dati e non logica
 *
 * Gli allegati del Reg. (UE) 2021/1165 cambiano — sostanze aggiunte, revocate,
 * condizioni d'uso modificate — e cambiano più spesso di quanto si riscriva un
 * modulo. Se l'elenco vivesse dentro un `if`, ogni aggiornamento normativo
 * sarebbe una modifica di codice da rilasciare; qui è una struttura dati con
 * l'atto e la **data di versione** accanto, che l'esito riporta sempre. Chi
 * legge un report sa così a quale versione dell'allegato si riferisce il
 * giudizio — e se è vecchia, lo vede.
 *
 * ## L'elenco è dichiaratamente PARZIALE
 *
 * Copre le voci più ricorrenti nei quaderni di campagna italiani, non l'intero
 * allegato. È una scelta esplicita, ed è il motivo per cui una sostanza NON
 * presente in elenco non produce mai "non ammessa": produce **non decidibile**,
 * con l'indicazione di verificarla sull'atto. Trattare l'assenza come divieto
 * significherebbe accusare l'agricoltore della nostra incompletezza.
 *
 * ## Due elenchi, non uno
 *
 * Per poter dire "non ammessa" senza dedurlo dal silenzio serve un elenco
 * ESPLICITO di sostanze di sintesi incompatibili con il metodo biologico
 * (`status: "prohibited"`). Le tre risposte possibili diventano così: ammessa,
 * non ammessa, **non decidibile** — e la terza non è un ripiego, è la risposta
 * corretta per tutto ciò che nessuno dei due elenchi copre.
 */

/** Allegato del Reg. (UE) 2021/1165 che ammette la voce. */
export type SubstanceAnnex =
  /** All. I — concimi, ammendanti e nutrienti. */
  | "I"
  /** All. II — prodotti fitosanitari. */
  | "II";

export interface SubstanceEntry {
  /** Nome canonico della sostanza/mezzo tecnico. */
  substance: string;
  /** Varianti che compaiono realmente sulle etichette e nei quaderni. */
  aliases: readonly string[];
  /**
   * `allowed` — la voce compare negli allegati del Reg. (UE) 2021/1165.
   * `prohibited` — sostanza di sintesi ESPLICITAMENTE incompatibile con il
   * metodo biologico.
   *
   * Le due liste sono separate di proposito, ed è il cuore dell'onestà del
   * motore: con il solo elenco delle ammesse, l'assenza di una voce
   * significherebbe "vietata", e siccome l'elenco è parziale accuseremmo
   * l'agricoltore della nostra incompletezza. Servono entrambe, e ciò che non
   * sta né di qua né di là resta **non decidibile**.
   */
  status: "allowed" | "prohibited";
  /** Allegato che la ammette (solo per le voci `allowed`). */
  annex: SubstanceAnnex | null;
  /** Condizione d'uso dichiarata dall'atto, se rilevante per l'esito. */
  restriction: string | null;
}

/** Elenco versionato: l'esito cita SEMPRE atto e versione da cui viene. */
export interface SubstanceReference {
  act: string;
  /** Data della versione del dato (non del rilascio del software). */
  version: string;
  sourceUrl: string | null;
  /** L'elenco copre le voci più comuni, non l'intero allegato. */
  partial: true;
  entries: readonly SubstanceEntry[];
}

/**
 * Normalizzazione dei nomi: minuscole, senza accenti, senza punteggiatura e
 * con gli spazi compattati. Serve perché "Ossicloruro di rame", "ossicloruro
 * di rame (Cu)" e "OSSICLORURO DI RAME" sono la stessa cosa scritta da tre
 * operatori diversi in tre momenti diversi.
 */
export function normalizeSubstance(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const ORGANIC_INPUT_REFERENCE: SubstanceReference = {
  act: "Reg. (UE) 2021/1165",
  version: "2024-01-01",
  sourceUrl: null,
  partial: true,
  entries: [
    // -- All. II: prodotti fitosanitari -------------------------------------
    {
      substance: "Composti del rame",
      aliases: [
        "rame",
        "solfato di rame",
        "ossicloruro di rame",
        "idrossido di rame",
        "ossido rameoso",
        "poltiglia bordolese",
        "copper",
      ],
      status: "allowed",
      annex: "II",
      restriction: "Massimo 28 kg di rame per ettaro in 7 anni.",
    },
    {
      substance: "Zolfo",
      aliases: ["zolfo", "zolfo bagnabile", "sulphur", "sulfur"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Bacillus thuringiensis",
      aliases: ["bacillus thuringiensis", "bt", "b thuringiensis"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Spinosad",
      aliases: ["spinosad"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Piretrine",
      aliases: ["piretrine", "piretro", "piretrina", "pyrethrins"],
      status: "allowed",
      annex: "II",
      restriction: "Estratte da Chrysanthemum cinerariaefolium.",
    },
    {
      substance: "Azadiractina",
      aliases: ["azadiractina", "azadirachtin", "olio di neem"],
      status: "allowed",
      annex: "II",
      restriction: "Estratta da Azadirachta indica.",
    },
    {
      substance: "Olio di paraffina",
      aliases: ["olio di paraffina", "olio bianco", "paraffin oil"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Bicarbonato di potassio",
      aliases: ["bicarbonato di potassio", "potassium bicarbonate"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Caolino",
      aliases: ["caolino", "kaolin"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Laminarina",
      aliases: ["laminarina", "laminarin"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },
    {
      substance: "Feromoni",
      aliases: ["feromoni", "confusione sessuale", "pheromones"],
      status: "allowed",
      annex: "II",
      restriction: "Solo in trappole e distributori.",
    },
    {
      substance: "Fosfato ferrico",
      aliases: ["fosfato ferrico", "ortofosfato di ferro", "iron phosphate"],
      status: "allowed",
      annex: "II",
      restriction: null,
    },

    // -- All. I: concimi e ammendanti ---------------------------------------
    {
      substance: "Letame",
      aliases: ["letame", "letame bovino", "stallatico", "farmyard manure"],
      status: "allowed",
      annex: "I",
      restriction: "Vietata la provenienza da allevamenti industriali.",
    },
    {
      substance: "Compost",
      aliases: ["compost", "ammendante compostato verde", "ammendante compostato misto"],
      status: "allowed",
      annex: "I",
      restriction: null,
    },
    {
      substance: "Digestato",
      aliases: ["digestato", "digestato agricolo"],
      status: "allowed",
      annex: "I",
      restriction: "Vietata la provenienza da allevamenti industriali.",
    },
    {
      substance: "Farina di sangue",
      aliases: ["farina di sangue", "sangue essiccato"],
      status: "allowed",
      annex: "I",
      restriction: null,
    },
    {
      substance: "Borlanda",
      aliases: ["borlanda", "borlanda fluida"],
      status: "allowed",
      annex: "I",
      restriction: null,
    },
    {
      substance: "Guano",
      aliases: ["guano"],
      status: "allowed",
      annex: "I",
      restriction: null,
    },
    {
      substance: "Solfato di potassio",
      aliases: ["solfato di potassio", "patentkali", "kieserite"],
      status: "allowed",
      annex: "I",
      restriction: "Da sali grezzi, ottenuto con processi fisici.",
    },
    {
      substance: "Fosfato naturale tenero",
      aliases: ["fosforite", "fosfato naturale", "fosfato naturale tenero"],
      status: "allowed",
      annex: "I",
      restriction: null,
    },
    {
      substance: "Calcare",
      aliases: ["calcare", "carbonato di calcio", "calce agricola"],
      status: "allowed",
      annex: "I",
      restriction: null,
    },

    // -- Sostanze di sintesi ESPLICITAMENTE incompatibili col biologico ------
    // Non sono "assenti dagli allegati": sono le voci per cui l'incompatibilità
    // è fuori discussione. Tenerle in un elenco separato è ciò che permette di
    // dire "non ammessa" senza dedurlo dal silenzio di un elenco parziale.
    {
      substance: "Glifosate",
      aliases: ["glifosate", "glifosato", "glyphosate"],
      status: "prohibited",
      annex: null,
      restriction: null,
    },
    {
      substance: "Mancozeb",
      aliases: ["mancozeb"],
      status: "prohibited",
      annex: null,
      restriction: null,
    },
    {
      substance: "Clorpirifos",
      aliases: ["clorpirifos", "chlorpyrifos", "clorpirifos metile"],
      status: "prohibited",
      annex: null,
      restriction: null,
    },
    {
      substance: "Imidacloprid",
      aliases: ["imidacloprid"],
      status: "prohibited",
      annex: null,
      restriction: null,
    },
    {
      substance: "Metalaxyl",
      aliases: ["metalaxyl", "metalaxil", "metalaxyl m"],
      status: "prohibited",
      annex: null,
      restriction: null,
    },
    {
      substance: "Tebuconazolo",
      aliases: ["tebuconazolo", "tebuconazole"],
      status: "prohibited",
      annex: null,
      restriction: null,
    },
    {
      substance: "Urea di sintesi",
      aliases: ["urea", "nitrato ammonico", "solfato ammonico", "npk di sintesi"],
      status: "prohibited",
      annex: null,
      restriction: "Concimi azotati minerali di sintesi.",
    },
    {
      substance: "Sementi non biologiche conciate",
      aliases: ["seme conciato", "semente conciata", "concia chimica"],
      status: "prohibited",
      annex: null,
      restriction: "Deroghe possibili previa autorizzazione dell'autorità competente.",
    },
  ],
};

/** Esito della ricerca di una sostanza nell'elenco versionato. */
export interface SubstanceLookup {
  entry: SubstanceEntry | null;
  /**
   * `true` quando la sostanza non compare in elenco. Non significa "vietata":
   * l'elenco è parziale, e l'esito corrispondente è "non decidibile".
   */
  unknown: boolean;
}

/**
 * Cerca una sostanza per nome canonico o alias.
 *
 * Il confronto è per contenimento di PAROLE INTERE sul nome normalizzato: le
 * etichette commerciali scrivono "Ossicloruro di rame 20% WG", e pretendere
 * l'uguaglianza esatta farebbe risultare sconosciuta quasi ogni riga reale di
 * un quaderno. Il vincolo sulle parole intere evita l'errore opposto — un alias
 * breve come "bt" che si aggancia a un frammento di un nome commerciale
 * qualunque.
 *
 * Le voci VIETATE si cercano per prime: un formulato il cui nome cita sia una
 * sostanza ammessa sia una di sintesi non deve poter passare per il primo
 * abbinamento fortunato.
 */
export function lookupSubstance(
  name: string | null | undefined,
  reference: SubstanceReference = ORGANIC_INPUT_REFERENCE,
): SubstanceLookup {
  if (!name || !name.trim()) return { entry: null, unknown: true };
  const needle = normalizeSubstance(name);
  if (!needle) return { entry: null, unknown: true };
  const haystack = ` ${needle} `;
  const matches = (entry: SubstanceEntry): boolean =>
    [entry.substance, ...entry.aliases]
      .map(normalizeSubstance)
      .some((c) => c.length > 0 && haystack.includes(` ${c} `));

  const prohibited = reference.entries.find(
    (e) => e.status === "prohibited" && matches(e),
  );
  if (prohibited) return { entry: prohibited, unknown: false };
  const allowed = reference.entries.find(
    (e) => e.status === "allowed" && matches(e),
  );
  return allowed ? { entry: allowed, unknown: false } : { entry: null, unknown: true };
}
