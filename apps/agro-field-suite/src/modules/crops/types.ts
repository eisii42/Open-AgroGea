import type {
  AlertFitopatologico,
  CropType as SpecieFenologica,
  FaseFenologica,
} from "@agrogea/tools";

/**
 * Contratti dei moduli per coltura (refactor architetturale §3).
 *
 * Ogni coltura ha un suo modulo verticale sotto `src/modules/crops/<coltura>/`
 * che **compone** gli engine puri di `@agrogea/tools` (fenologia, fitopatologia,
 * agrometeo) — la logica di calcolo NON viene duplicata né spostata: i pacchetti
 * restano isolati e testati. Il modulo dichiara solo cosa è specifico della
 * coltura: i suoi DSS patologici, la specie fenologica di riferimento (da cui
 * derivano Kc per fase, soglie GDD e soil-mask) e i widget UI di dettaglio.
 */

/** Categoria coltura a livello di appezzamento (campo `coltura` del dominio). */
export type CategoriaColtura =
  | "viticoltura"
  | "seminativo"
  | "olivicoltura"
  | "frutticoltura"
  | "orticoltura";

/**
 * Record meteo giornaliero unificato per i DSS (superset dei campi richiesti
 * dai singoli motori di `fitopatologia`). Ogni modulo adatta questa serie alla
 * forma attesa dall'engine che compone.
 */
export interface MeteoGiornoDss {
  /** ISO date del giorno. */
  data: string;
  tMin: number;
  tMax: number;
  /** Umidità relativa media (%). */
  rhMedia: number;
  /** Pioggia del giorno (mm). */
  pioggia: number;
  /**
   * Ore di bagnatura fogliare del giorno (0..24), per i modelli di infezione
   * fungina che correlano bagnatura e temperatura. Opzionale: presente solo se
   * la fonte meteo la misura o la stima.
   */
  bagnaturaOre?: number;
}

/** Contesto fenologico/colturale per i DSS che ne dipendono. */
export interface ContestoDss {
  fase?: FaseFenologica;
  /** Lunghezza germogli (cm), usata dalla regola tre-dieci della vite. */
  lunghezzaGermogliCm?: number;
  /**
   * Biofix dell'accumulo termico (ISO date): i gradi-giorno si sommano SOLO dai
   * giorni ≥ questa data, non dall'inizio della finestra meteo disponibile.
   * Ancora l'accumulo a un riferimento agronomico (1° gennaio, semina, ripresa
   * vegetativa) e lo rende indipendente da quanta storia è stata scaricata.
   */
  dataInizioAccumuloGdd?: string;
}

/**
 * Descrittore di un DSS patologico/fenologico della coltura. `valuta` compone un
 * motore puro di `fitopatologia` su una serie meteo e ritorna l'alert (o null).
 */
export interface DssModel {
  id: string;
  nome: string;
  /** Bersaglio: patogeno, insetto o evento fenologico. */
  bersaglio: string;
  descrizione: string;
  valuta: (
    serie: MeteoGiornoDss[],
    contesto?: ContestoDss,
  ) => AlertFitopatologico | null;
}

/** Modulo verticale di una coltura. */
export interface CropModule {
  /** Id stabile del modulo (es. "vite"). */
  id: string;
  /** Etichetta UI (es. "Vite"). */
  label: string;
  /** Categorie di appezzamento gestite da questo modulo. */
  categorie: CategoriaColtura[];
  /**
   * Specie fenologica di riferimento per Kc/soil-mask/GDD (chiave delle matrici
   * di `fenologia`). Es. la viticoltura usa la specie "vite".
   */
  speciePrincipale: SpecieFenologica;
  /** DSS patologici/fenologici disponibili per la coltura. */
  dss: DssModel[];
  /**
   * true se la coltura ha modelli ad accumulo termico STAGIONALE (gradi-giorno
   * che maturano su mesi: spigatura cereali, generazioni d'insetto…). Abilita il
   * backfill dello storico meteo via Archive API, così l'accumulo parte dal
   * biofix e non dai pochi giorni di previsione. Le colture con soli modelli
   * giornalieri (es. vite: peronospora/oidio) la lasciano falsa.
   */
  accumuloStagionale?: boolean;
}
