import { cn } from "@geolibre/ui";
import { CalendarPlus, ChevronRight, NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ForecastDay } from "../../lib/WeatherSyncService";
import { weatherCodeInfo } from "../../lib/weather-codes";
import type { CalendarEvent } from "./calendar-events";

/** Pallini per giorno: oltre, la cella segnala solo che c'è altro. */
const MAX_DOTS = 4;

/**
 * Mese del Calendario sul telefono: griglia compatta e, sotto, l'agenda del
 * giorno scelto.
 *
 * Sul desktop ogni cella mostra le etichette delle voci; a 375 px le celle sono
 * larghe 48 px e quelle etichette diventavano righe illeggibili da 9 px. Qui la
 * cella dice solo SE c'è qualcosa e di che tipo (un pallino per colore, come
 * nella legenda) e il meteo in icona; il contenuto del giorno si legge per
 * esteso nell'agenda, dove si pianifica o si registra sul giorno scelto.
 */
export function CalendarMobileMonth({
  cells,
  weekdays,
  eventsByDay,
  weather,
  today,
  selectedDay,
  readOnly,
  onSelectDay,
  onOpenDay,
  onAddTask,
  onAddOperation,
}: {
  cells: (string | null)[];
  weekdays: string[];
  eventsByDay: Map<string, CalendarEvent[]>;
  weather: Map<string, ForecastDay>;
  today: string;
  selectedDay: string;
  readOnly: boolean;
  onSelectDay: (day: string) => void;
  /** Apre il dettaglio completo del giorno (schede delle voci, modifica task). */
  onOpenDay: (day: string) => void;
  onAddTask: (day: string) => void;
  onAddOperation: (day: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const dayEvents = eventsByDay.get(selectedDay) ?? [];
  const dayWeather = weather.get(selectedDay);
  const dayInfo = weatherCodeInfo(dayWeather?.weatherCode);
  const DayWeatherIcon = dayInfo.Icon;
  const readableDay = new Date(`${selectedDay}T00:00:00`).toLocaleDateString(
    i18n.language,
    { weekday: "long", day: "numeric", month: "long" },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1 rounded-[var(--r-3)] bg-[var(--panel)] p-1.5">
        {weekdays.map((label) => (
          <div
            key={label}
            className="pb-0.5 text-center text-[11px] font-medium text-[var(--ink-4)]"
          >
            {label}
          </div>
        ))}
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} />;
          const events = eventsByDay.get(day) ?? [];
          // Un pallino per colore distinto: il tipo, non il numero di voci.
          const colors = [...new Set(events.map((e) => e.color))];
          const isToday = day === today;
          const selected = day === selectedDay;
          const forecast = weather.get(day);
          const Icon = weatherCodeInfo(forecast?.weatherCode).Icon;
          return (
            <button
              type="button"
              key={day}
              onClick={() => onSelectDay(day)}
              aria-pressed={selected}
              aria-label={`${Number(day.slice(8, 10))}${
                events.length ? ` · ${events.length}` : ""
              }`}
              className={cn(
                "flex min-h-[54px] flex-col items-center justify-start gap-1 rounded-[var(--r-2)] pt-1.5 transition-colors",
                selected
                  ? "bg-[var(--accent)] text-white"
                  : isToday
                    ? "bg-[var(--accent-l)] text-[var(--accent)]"
                    : "text-[var(--ink-2)] active:bg-[var(--panel-2)]",
              )}
            >
              <span className="text-[14px] font-semibold leading-none">
                {Number(day.slice(8, 10))}
              </span>
              {forecast ? (
                <Icon
                  size={12}
                  className={selected ? "text-white/85" : "text-[var(--ink-4)]"}
                />
              ) : (
                <span className="h-3" />
              )}
              <span className="flex h-1.5 items-center gap-0.5">
                {colors.slice(0, MAX_DOTS).map((color) => (
                  <span
                    key={color}
                    className={cn("h-1.5 w-1.5 rounded-full", selected && "ring-1 ring-white")}
                    style={{ background: color }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Agenda del giorno scelto. */}
      <section className="flex flex-col gap-2 rounded-[var(--r-3)] bg-[var(--panel)] p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold capitalize">{readableDay}</h3>
            {dayWeather && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[var(--ink-3)]">
                <DayWeatherIcon size={15} />
                {dayInfo.label}
                {dayWeather.tMax != null && ` · ${Math.round(dayWeather.tMax)}°`}
                {dayWeather.tMin != null && ` / ${Math.round(dayWeather.tMin)}°`}
                {dayWeather.pioggiaMm != null && dayWeather.pioggiaMm >= 0.1 && (
                  <span className="text-[#0284c7]">
                    · {dayWeather.pioggiaMm.toFixed(1)} mm
                  </span>
                )}
              </p>
            )}
          </div>
          {dayEvents.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenDay(selectedDay)}
              className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-[var(--r-2)] px-2 text-[13px] font-medium text-[var(--accent)] active:bg-[var(--panel-2)]"
            >
              {t("calendar.dayDetail")}
              <ChevronRight size={15} />
            </button>
          )}
        </div>

        {dayEvents.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">{t("calendar.noEventsForDay")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dayEvents.map((event) => (
              <li key={event.key}>
                <button
                  type="button"
                  onClick={() => onOpenDay(selectedDay)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--r-2)] px-1 text-left active:bg-[var(--panel-2)]"
                >
                  <span
                    className={cn("h-8 w-1 shrink-0 rounded-full", event.future && "opacity-60")}
                    style={{ background: event.color }}
                  />
                  <span className="min-w-0 flex-1 text-[14px] leading-snug text-[var(--ink-2)]">
                    {event.label}
                  </span>
                  {event.future && (
                    <span className="shrink-0 text-[11px] text-[var(--ink-4)]">
                      {t("calendar.planned")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onAddTask(selectedDay)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] text-[14px] font-medium active:bg-[var(--panel-2)]"
            >
              <CalendarPlus size={16} /> {t("calendar.addTask")}
            </button>
            <button
              type="button"
              onClick={() => onAddOperation(selectedDay)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--r-2)] bg-[var(--accent)] text-[14px] font-medium text-white active:opacity-90"
            >
              <NotebookPen size={16} /> {t("mobileCalendar.addOperationShort")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
