import { useAgroStore } from "@agrogea/core";
import type { VegetationIndexScene } from "@agrogea/core";
import { indexCellValues, relativeDomain } from "@agrogea/tools";
import { cn } from "@geolibre/ui";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  CopyMinus,
  CopyPlus,
  Loader2,
  Pause,
  Play,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { usePlatform } from "../../hooks/usePlatform";
import { cellsForScene, processScenes, sceneCoversIndices } from "./index-cache";
import {
  currentIndexCellsDomain,
  injectIndexCells,
} from "./index-cells-layer";
import {
  buildTimelineScenes,
  markTimelineSceneCached,
  publishFocusPlot,
  setTimelineActiveScene,
  setTimelineError,
  setTimelineLoading,
  useIndexTimeline,
  type TimelineScene,
} from "./index-timeline-store";

/**
 * Time slider degli indici: la navigazione temporale delle scene di UN
 * appezzamento, ancorata in basso sulla mappa dopo un calcolo.
 *
 * Mostra TUTTO il disponibile distinguendo due stati:
 *   * scene in cache (pallino pieno) — si disegnano all'istante, senza rete;
 *   * scene esistenti sul satellite ma mai elaborate (pallino vuoto) — si
 *     calcolano al volo al primo click e da quel momento sono in cache.
 *
 * I DOPPIONI GIORNALIERI (più passaggi nello stesso giorno, tutti sotto la
 * soglia di nuvolosità) sono nascosti di default: resta la scena meno nuvolosa
 * del giorno, che è poi l'unica che l'analisi elabora. Un comando li rimette in
 * striscia, in ambra, per chi vuole confrontarli a mano.
 *
 * Layout UNICO per desktop e smartphone: una striscia di tacche a spaziatura
 * PROPORZIONALE al tempo (i vuoti raccontano i periodi nuvolosi, che è metà
 * dell'informazione) dentro un contenitore che scorre in orizzontale. Su
 * desktop l'intero periodo entra e non si scorre nulla; su mobile la striscia
 * scorre e la tacca attiva viene sempre riportata in vista. Nessuna doppia
 * implementazione da tenere allineata: cambiano solo gli ancoraggi del
 * contenitore, che su mobile sta sopra la tab bar e su desktop lascia libera la
 * colonna della colorbar.
 */

/** Distanza minima fra due tacche: sotto, il tap sbaglia bersaglio. */
const MIN_TICK_GAP_PX = 32;
/** Margine laterale della striscia, così la prima/ultima tacca non tocca il bordo. */
const TRACK_PADDING_PX = 18;
/** Passo dell'animazione: abbastanza lento da leggere la data che cambia. */
const PLAY_INTERVAL_MS = 900;

/**
 * Posizioni orizzontali delle tacche: proporzionali alla data, poi separate di
 * almeno {@link MIN_TICK_GAP_PX} con una passata da sinistra a destra. Così due
 * passaggi a un giorno di distanza restano cliccabili senza perdere la
 * spaziatura reale del resto della serie.
 */
function tickPositions(scenes: TimelineScene[], available: number): number[] {
  if (scenes.length === 0) return [];
  if (scenes.length === 1) return [TRACK_PADDING_PX];

  const first = Date.parse(scenes[0].datetime);
  const last = Date.parse(scenes[scenes.length - 1].datetime);
  const span = Math.max(1, last - first);
  const usable = Math.max(1, available - TRACK_PADDING_PX * 2);

  const positions = scenes.map(
    (scene) =>
      TRACK_PADDING_PX +
      ((Date.parse(scene.datetime) - first) / span) * usable,
  );
  for (let i = 1; i < positions.length; i++) {
    positions[i] = Math.max(positions[i], positions[i - 1] + MIN_TICK_GAP_PX);
  }
  return positions;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function IndexTimeSlider() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const timeline = useIndexTimeline();
  const plots = useAgroStore((s) => s.plots);
  const sidebarCollapsed = useAgroStore((s) => s.sidebarCollapsed);

  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTickRef = useRef<HTMLButtonElement>(null);

  const { scenes, activeSceneId, focusPlotId, loadingSceneId } = timeline;

  // Serie effettivamente in striscia: senza i doppioni del giorno, a meno che
  // l'utente li abbia richiesti. La scena a video resta sempre visibile, anche
  // se è un doppione scelto a mano prima di rinascondere gli altri.
  const duplicateCount = scenes.filter((s) => !s.bestOfDay).length;
  const visibleScenes = scenes.filter(
    (s) => s.bestOfDay || showDuplicates || s.sceneId === activeSceneId,
  );
  const activeIndex = visibleScenes.findIndex(
    (s) => s.sceneId === activeSceneId,
  );

  // Larghezza disponibile della striscia: le tacche restano proporzionali al
  // tempo finché ci stanno, e il contenitore scorre solo quando servirebbe più
  // spazio della larghezza reale.
  useLayoutEffect(() => {
    // La striscia esiste solo da espansa: l'osservatore va riagganciato ogni
    // volta che si riapre, altrimenti la larghezza resta quella di una vita fa.
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setTrackWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setTrackWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [collapsed]);

  const positions = tickPositions(visibleScenes, trackWidth);
  const innerWidth = Math.max(
    trackWidth,
    (positions.at(-1) ?? 0) + TRACK_PADDING_PX,
  );

  /**
   * Porta a video la scena scelta. Se non è in cache (o non copre gli indici
   * della run) la calcola prima, e da quel momento è a costo zero.
   */
  const showScene = useCallback(
    async (scene: TimelineScene) => {
      const plot = plots.find((p) => p.id === focusPlotId);
      if (!plot) return;
      setTimelineLoading(scene.sceneId);
      try {
        const dal = useAgroStore.getState().dal;
        const cachedList = dal
          ? await dal.listVegetationIndexScenes(plot.id)
          : [];
        let cachedScene: VegetationIndexScene | null =
          cachedList.find((c) => c.scene_id === scene.sceneId) ?? null;

        let fresh = null;
        if (!cachedScene || !sceneCoversIndices(cachedScene, timeline.indices)) {
          if (!scene.source) {
            throw new Error(t("indexTimeSlider.notComputable"));
          }
          const payloads = await processScenes({
            dal,
            plot,
            scenes: [scene.source],
            indices: timeline.indices,
            primaryIndex: timeline.primaryIndex,
            onScenePersisted: (saved) => {
              cachedScene = saved;
            },
          });
          fresh = payloads.get(scene.sceneId) ?? null;
        }

        const cells = await cellsForScene({
          dal,
          plotId: plot.id,
          datetime: scene.datetime,
          primaryIndex: timeline.primaryIndex,
          indices: timeline.indices,
          fresh,
          cachedScene,
        });
        if (!cells) throw new Error(t("indexTimeSlider.noRaster"));

        // Scala colore FISSA su tutto lo scorrimento: ricalcolarla a ogni data
        // farebbe sembrare variazioni di vigore quelle che sono solo variazioni
        // di scala. Si adotta quella già in mappa, se c'è.
        const domain =
          currentIndexCellsDomain(plot.id) ??
          relativeDomain(indexCellValues(cells.cells));
        injectIndexCells(plot, cells, domain);
        setTimelineActiveScene(scene.sceneId);
        markTimelineSceneCached(scene.sceneId);
      } catch (error) {
        setPlaying(false);
        setTimelineError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setTimelineLoading(null);
      }
    },
    [focusPlotId, plots, t, timeline.indices, timeline.primaryIndex],
  );

  /** Passo avanti/indietro; in riproduzione si salta alle sole scene in cache. */
  const step = useCallback(
    (direction: 1 | -1, cachedOnly = false) => {
      if (visibleScenes.length === 0) return;
      let next =
        activeIndex < 0 ? visibleScenes.length - 1 : activeIndex + direction;
      while (next >= 0 && next < visibleScenes.length) {
        if (!cachedOnly || visibleScenes[next].cached) {
          void showScene(visibleScenes[next]);
          return;
        }
        next += direction;
      }
      // Fine corsa: l'animazione si ferma da sé.
      if (cachedOnly) setPlaying(false);
    },
    [activeIndex, visibleScenes, showScene],
  );

  // Riproduzione: solo scene già in cache, così premere "play" non innesca una
  // sequenza di download a insaputa dell'utente.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => step(1, true), PLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, step]);

  // La tacca attiva resta sempre in vista quando la striscia scorre (su mobile
  // la serie è quasi sempre più larga dello schermo).
  useEffect(() => {
    activeTickRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeSceneId, collapsed]);

  /** Cambio appezzamento a fuoco: si ricostruisce la sua timeline dalla cache. */
  const changeFocus = useCallback(async (plotId: string) => {
    const dal = useAgroStore.getState().dal;
    const cached = dal ? await dal.listVegetationIndexScenes(plotId) : [];
    publishFocusPlot({
      focusPlotId: plotId,
      // Le scene STAC della run valgono solo per l'appezzamento cercato: per
      // gli altri si mostra ciò che è in cache, tutto già calcolato.
      scenes: buildTimelineScenes([], cached),
      activeSceneId: null,
    });
  }, []);

  if (scenes.length === 0 || !focusPlotId || timeline.hidden) return null;

  const active = activeIndex >= 0 ? visibleScenes[activeIndex] : null;
  const cachedCount = visibleScenes.filter((s) => s.cached).length;

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30 flex justify-center",
        // Mobile: sopra la tab bar, a tutta larghezza. Desktop: allineato alla
        // colonna dei moduli e libero dalla colorbar (che sta a destra).
        platform.isMobile
          ? "bottom-[4.5rem] left-2 right-2"
          : cn("bottom-3 right-32", sidebarCollapsed ? "left-3" : "left-[272px]"),
      )}
    >
      <div className="pointer-events-auto w-full max-w-3xl rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]">
        {/* Intestazione: appezzamento, data corrente, comandi. */}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          {timeline.plots.length > 1 ? (
            <select
              value={focusPlotId}
              onChange={(e) => void changeFocus(e.target.value)}
              aria-label={t("indexTimeSlider.plotSelector")}
              className="min-w-0 max-w-[9rem] shrink truncate rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-1.5 py-1 text-xs text-[var(--ink-2)]"
            >
              {timeline.plots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 truncate text-xs font-medium text-[var(--ink-2)]">
              {timeline.plots[0]?.name}
            </span>
          )}

          <span className="agro-num flex-1 truncate text-center text-[13px] font-semibold">
            {active ? longDate(active.datetime) : t("indexTimeSlider.pickScene")}
            {active?.cloudCover != null && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-normal text-[var(--ink-4)]">
                <Cloud size={11} />
                {active.cloudCover.toFixed(0)}%
              </span>
            )}
          </span>

          <div className="flex shrink-0 items-center gap-0.5">
            {duplicateCount > 0 && (
              <IconBtn
                label={
                  showDuplicates
                    ? t("indexTimeSlider.hideDuplicates")
                    : t("indexTimeSlider.showDuplicates", {
                        count: duplicateCount,
                      })
                }
                onClick={() => setShowDuplicates((v) => !v)}
                active={showDuplicates}
              >
                {showDuplicates ? (
                  <CopyMinus size={16} />
                ) : (
                  <CopyPlus size={16} />
                )}
              </IconBtn>
            )}
            <IconBtn
              label={t("indexTimeSlider.previous")}
              onClick={() => step(-1)}
              disabled={loadingSceneId != null || activeIndex <= 0}
            >
              <ChevronLeft size={16} />
            </IconBtn>
            <IconBtn
              label={
                playing ? t("indexTimeSlider.pause") : t("indexTimeSlider.play")
              }
              onClick={() => setPlaying((v) => !v)}
              // Con una sola scena in cache non c'è nulla da animare.
              disabled={cachedCount < 2}
              active={playing}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </IconBtn>
            <IconBtn
              label={t("indexTimeSlider.next")}
              onClick={() => step(1)}
              disabled={
                loadingSceneId != null ||
                (activeIndex >= 0 && activeIndex >= visibleScenes.length - 1)
              }
            >
              <ChevronRight size={16} />
            </IconBtn>
            <IconBtn
              label={
                collapsed
                  ? t("indexTimeSlider.expand")
                  : t("indexTimeSlider.collapse")
              }
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </IconBtn>
          </div>
        </div>

        {!collapsed && (
          <>
            <div
              ref={scrollRef}
              className="overflow-x-auto overflow-y-hidden px-0 pb-1"
            >
              <div
                className="relative h-11"
                style={{ width: `${innerWidth}px` }}
              >
                {/* Asse dei tempi. */}
                <div className="absolute left-0 right-0 top-[18px] h-px bg-[var(--line)]" />
                {visibleScenes.map((scene, i) => {
                  const isActive = scene.sceneId === activeSceneId;
                  const isLoading = scene.sceneId === loadingSceneId;
                  const isDuplicate = !scene.bestOfDay;
                  return (
                    <button
                      key={scene.sceneId}
                      ref={isActive ? activeTickRef : undefined}
                      type="button"
                      disabled={loadingSceneId != null}
                      onClick={() => void showScene(scene)}
                      title={`${longDate(scene.datetime)}${
                        scene.cached
                          ? ` · ${t("indexTimeSlider.computed")}`
                          : ` · ${t("indexTimeSlider.notComputed")}`
                      }${
                        scene.cloudCover != null
                          ? ` · ${scene.cloudCover.toFixed(0)}%`
                          : ""
                      }${
                        isDuplicate
                          ? ` · ${t("indexTimeSlider.duplicate")}`
                          : ""
                      }`}
                      className="absolute top-0 flex h-11 w-8 -translate-x-1/2 flex-col items-center justify-start pt-2.5"
                      style={{ left: `${positions[i]}px` }}
                    >
                      {isLoading ? (
                        <Loader2
                          size={13}
                          className="animate-spin text-[var(--accent)]"
                        />
                      ) : (
                        <span
                          className={cn(
                            "h-3 w-3 rounded-full border-2 transition-transform",
                            // Doppione del giorno: ambra, in cache o no — quel
                            // che conta è che non è la scena "buona" del giorno.
                            isDuplicate
                              ? scene.cached
                                ? "border-[var(--warn)] bg-[var(--warn)]"
                                : "border-[var(--warn)] bg-[var(--panel)]"
                              : scene.cached
                                ? "border-[var(--accent)] bg-[var(--accent)]"
                                : "border-[var(--ink-4)] bg-[var(--panel)]",
                            isActive &&
                              "scale-125 ring-2 ring-offset-1 ring-offset-[var(--panel)]",
                            isActive &&
                              (isDuplicate
                                ? "ring-[var(--warn)]"
                                : "ring-[var(--accent)]"),
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "agro-num mt-1 text-[9px] leading-none",
                          isActive && "font-semibold",
                          isDuplicate
                            ? "text-[var(--warn)]"
                            : isActive
                              ? "text-[var(--accent)]"
                              : "text-[var(--ink-4)]",
                        )}
                      >
                        {shortDate(scene.datetime)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Legenda + esito: una riga sola, la stessa su desktop e mobile. */}
            <div className="flex items-center gap-3 border-t border-[var(--line)] px-2.5 py-1 text-[10px] text-[var(--ink-4)]">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                {t("indexTimeSlider.computedCount", {
                  count: cachedCount,
                })}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--ink-4)]" />
                {t("indexTimeSlider.notComputedCount", {
                  count: visibleScenes.length - cachedCount,
                })}
              </span>
              {duplicateCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDuplicates((v) => !v)}
                  className="flex items-center gap-1 hover:text-[var(--ink-2)]"
                >
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--warn)]" />
                  {showDuplicates
                    ? t("indexTimeSlider.duplicatesShown", {
                        count: duplicateCount,
                      })
                    : t("indexTimeSlider.duplicatesHidden", {
                        count: duplicateCount,
                      })}
                </button>
              )}
              {timeline.error && (
                <span className="ml-auto truncate text-[var(--danger)]">
                  {timeline.error}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[var(--r-2)]",
        active
          ? "bg-[var(--accent-l)] text-[var(--accent)]"
          : "text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}
