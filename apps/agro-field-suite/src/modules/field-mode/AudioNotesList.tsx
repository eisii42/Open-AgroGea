import { type AudioNote, useAgroStore } from "@agrogea/core";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Elenco compatto delle note vocali della sessione con riproduzione: la
 * revisione completa (waveform, trascrizione, cancellazione) resta per il
 * riepilogo post-operazione — qui basta poter riascoltare al volo senza
 * affollare lo schermo ad alto contrasto. Un solo `<audio>` condiviso: la
 * riproduzione di una nota ferma automaticamente quella precedente.
 */
export function AudioNotesList({ notes }: { notes: AudioNote[] }) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  async function handleToggle(note: AudioNote) {
    const audio = audioRef.current;
    if (playingId === note.id && audio) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    if (!dal) return;
    setLoadingId(note.id);
    try {
      const blob = await dal.loadAudioBlob(note.audio_uri);
      if (!blob) return;
      const player = audioRef.current ?? new Audio();
      audioRef.current = player;
      player.src = `data:${blob.mime_type};base64,${blob.data_base64}`;
      player.onended = () => setPlayingId(null);
      await player.play();
      setPlayingId(note.id);
    } catch {
      setPlayingId(null);
    } finally {
      setLoadingId(null);
    }
  }

  if (notes.length === 0) return null;

  const sorted = [...notes].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-lime-400/70">
        {t("fieldMode.dashboard.audioNotes.title", { count: notes.length })}
      </p>
      <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
        {sorted.map((note) => {
          const isPlaying = playingId === note.id;
          return (
            <li
              key={note.id}
              className="flex items-center gap-2 rounded-lg border border-lime-400/30 bg-black/50 px-3 py-2"
            >
              <button
                type="button"
                onClick={() => void handleToggle(note)}
                disabled={loadingId === note.id}
                aria-label={t(
                  isPlaying
                    ? "fieldMode.dashboard.audioNotes.pause"
                    : "fieldMode.dashboard.audioNotes.play",
                )}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-400 text-black disabled:opacity-50"
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <span className="flex-1 truncate text-sm text-lime-100">
                {new Date(note.recorded_at).toLocaleTimeString()}
              </span>
              {note.duration_s != null && (
                <span className="shrink-0 text-xs text-lime-400/70">
                  {Math.round(note.duration_s)}s
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
