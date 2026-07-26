import { type FieldOperationSession, useAgroStore } from "@agrogea/core";
import type { GeoSample } from "@agrogea/tools";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createVoiceNoteRecorder,
  type VoiceNoteRecorder,
} from "../../services/audio/voice-recorder";

/**
 * Note vocali geotaggate a bordo campo: incapsula `voice-recorder.ts`
 * (MediaRecorder framework-free) + la persistenza via
 * `saveSessionAudioNote` dello store (blob LOCAL-ONLY + append in
 * `audio_notes`, vedi `AgroDalTasks.saveAudioNote`). Interazione a
 * TOCCO-TOCCO (tap per avviare, tap per fermare) e non a pressione
 * prolungata: con i guanti da campo un "hold" sostenuto è più fragile
 * (rilascio accidentale, poca sensibilità tattile su terreno sconnesso) di
 * due tocchi netti — vedi il pulsante nell'InFieldDashboard.
 *
 * Il lat/lon della nota viene dall'ULTIMO campione GPS ACCETTATO (accuratezza
 * entro soglia) letto da `useFieldSessionTracking`, mai da un campione
 * grezzo scartato dal geofencing.
 */
export function useVoiceNoteRecorder(
  session: FieldOperationSession | null,
  lastAcceptedSample: GeoSample | null,
): {
  recording: boolean;
  elapsedS: number;
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const { t } = useTranslation();
  const saveSessionAudioNote = useAgroStore((s) => s.saveSessionAudioNote);
  const [recording, setRecording] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recorderRef = useRef<VoiceNoteRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lastSampleRef = useRef(lastAcceptedSample);
  lastSampleRef.current = lastAcceptedSample;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current || !sessionRef.current) return;
    setErrorMessage(null);
    const recorder = createVoiceNoteRecorder();
    const outcome = await recorder.start();
    if (!outcome.ok) {
      setErrorMessage(t(`fieldMode.error.${outcome.code}` as never));
      return;
    }
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedS(0);
    setRecording(true);
    timerRef.current = window.setInterval(() => {
      setElapsedS(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
  }, [t]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    clearTimer();
    setRecording(false);
    if (!session) {
      recorder.cancel();
      return;
    }
    try {
      const result = await recorder.stop();
      if (!result) return;
      const durationS = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      const sample = lastSampleRef.current;
      await saveSessionAudioNote(session.id, {
        mime_type: result.mimeType,
        duration_s: durationS,
        data_base64: result.base64,
        // In pratica il geofencing richiede già un fix GPS per rilevare
        // l'ingresso nel field: un campione accettato è sempre available a
        // questo punto. Il fallback (0,0) copre solo il caso limite di una
        // sessione avviata manualmente senza alcun fix ancora ricevuto.
        lat: sample?.lat ?? 0,
        lon: sample?.lon ?? 0,
      });
    } catch {
      setErrorMessage(t("fieldMode.error.mic_recording_failed"));
    }
  }, [clearTimer, saveSessionAudioNote, t]);

  return { recording, elapsedS, errorMessage, start, stop };
}
