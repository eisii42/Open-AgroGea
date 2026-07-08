import type {
  PhytopathologyAlert,
  CropType as PhenologicalSpecies,
  PhenologicalPhase,
} from "@agrogea/tools";

/**
 * Contratti dei moduli per crop (refactor architetturale §3).
 *
 * Ogni crop ha un suo module verticale sotto `src/modules/crops/<crop>/`
 * che **compone** gli engine puri di `@agrogea/tools` (fenologia, fitopatologia,
 * agrometeo) — la logica di calcolo NON viene duplicata né spostata: i pacchetti
 * restano isolati e testati. Il module dichiara solo cosa è specifico della
 * crop: i suoi DSS patologici, la specie fenologica di riferimento (da cui
 * derivano Kc per phase, soglie GDD e soil-mask) e i widget UI di dettaglio.
 */

/** Categoria crop a livello di plot (field `coltura` del dominio). */
export type CropCategory =
  | "viticoltura"
  | "seminativo"
  | "olivicoltura"
  | "frutticoltura"
  | "orticoltura";

/**
 * Record meteo giornaliero unificato per i DSS (superset dei campi richiesti
 * dai singoli motori di `fitopatologia`). Ogni module adatta questa series alla
 * forma attesa dall'engine che compone.
 */
export interface DssWeatherDay {
  /** ISO date del day. */
  data: string;
  tMin: number;
  tMax: number;
  /** Umidità relativa media (%). */
  rhMean: number;
  /** Pioggia del day (mm). */
  rain: number;
  /**
   * Ore di bagnatura fogliare del day (0..24), per i modelli di infezione
   * fungina che correlano bagnatura e temperatura. Opzionale: presente solo se
   * la fonte meteo la misura o la stima.
   */
  leafWetnessHours?: number;
}

/** Contesto fenologico/colturale per i DSS che ne dipendono. */
export interface DssContext {
  phase?: PhenologicalPhase;
  /** Lunghezza germogli (cm), usata dalla regola tre-dieci della vite. */
  shootLengthCm?: number;
  /**
   * Biofix dell'accumulo termico (ISO date): i gradi-day si sommano SOLO dai
   * giorni ≥ questa data, non dall'inizio della finestra meteo disponibile.
   * Ancora l'accumulo a un riferimento agronomico (1° gennaio, semina, ripresa
   * vegetativa) e lo rende indipendente da quanta storia è stata scaricata.
   */
  gddStartDate?: string;
}

/**
 * Descrittore di un DSS patologico/fenologico della crop. `evaluate` compone un
 * motore puro di `fitopatologia` su una series meteo e ritorna l'alert (o null).
 */
export interface DssModel {
  id: string;
  name: string;
  /** Bersaglio: patogeno, insetto o evento fenologico. */
  target: string;
  description: string;
  evaluate: (
    series: DssWeatherDay[],
    context?: DssContext,
  ) => PhytopathologyAlert | null;
}

/** Modulo verticale di una crop. */
export interface CropModule {
  /** Id stabile del module (es. "vite"). */
  id: string;
  /** Etichetta UI (es. "Vite"). */
  label: string;
  /** Categorie di plot gestite da questo module. */
  categories: CropCategory[];
  /**
   * Specie fenologica di riferimento per Kc/soil-mask/GDD (chiave delle matrici
   * di `fenologia`). Es. la viticoltura usa la specie "vite".
   */
  mainSpecies: PhenologicalSpecies;
  /** DSS patologici/fenologici disponibili per la crop. */
  dss: DssModel[];
  /**
   * true se la crop ha modelli ad accumulo termico STAGIONALE (gradi-day
   * che maturano su mesi: spigatura cereali, generazioni d'insetto…). Abilita il
   * backfill dello storico meteo via Archive API, così l'accumulo parte dal
   * biofix e non dai pochi giorni di previsione. Le colture con soli modelli
   * giornalieri (es. vite: peronospora/oidio) la lasciano falsa.
   */
  seasonalAccumulation?: boolean;
}
