/**
 * Wrapper framework-free su `getUserMedia`/`MediaRecorder` per le note vocali
 * geotaggate della Modalità Campo. Nessuna registrazione audio esisteva prima
 * in questo repository: questo file isola le API browser (stesso stile di
 * `services/geofencing/geofence-watcher.ts`), l'hook React che tiene lo stato
 * (`useVoiceNoteRecorder`) resta a parte e testabile senza un vero microfono.
 *
 * Il browser non garantisce un MIME type stabile fra piattaforme (Chrome/
 * Firefox preferiscono webm/opus, Safari preferisce mp4/aac): si prova una
 * lista di candidati con `MediaRecorder.isTypeSupported` e si usa il primo
 * supportato, ripiegando sul default del browser se nessuno lo è
 * esplicitamente (mai un'eccezione per un MIME type "sbagliato").
 */

/**
 * Prefisso `mic_` deliberato: il namespace i18n `fieldMode.error` porta già
 * `permission_denied`/`unavailable`/`timeout` per il GPS (messaggi specifici
 * per la geolocalizzazione) — riusare le stesse chiavi per il microfono
 * mostrerebbe un testo sbagliato ("Attiva la geolocalizzazione…" per un
 * permesso microfono negato). Chiavi distinte, stesso namespace.
 */
export type VoiceRecorderErrorCode =
  | "mic_unsupported"
  | "mic_permission_denied"
  | "mic_recording_failed";

export interface VoiceRecorderResult {
  /** Contenuto audio codificato in base64 (SENZA il prefisso `data:...;base64,`). */
  base64: string;
  mimeType: string;
}

export interface VoiceNoteRecorder {
  /** Chiede il permesso microfono e avvia la registrazione. */
  start: () => Promise<{ ok: true } | { ok: false; code: VoiceRecorderErrorCode }>;
  /** Ferma la registrazione e ritorna il blob codificato, o null se non stava registrando. */
  stop: () => Promise<VoiceRecorderResult | null>;
  /** Interrompe SENZA salvare (annullamento): rilascia comunque il microfono. */
  cancel: () => void;
}

const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Estrae il solo payload base64 da una data URL `data:<mime>;base64,<payload>`. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader: risultato inatteso"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export function createVoiceNoteRecorder(): VoiceNoteRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let mimeType = "audio/webm";

  function releaseStream(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function start(): Promise<
    { ok: true } | { ok: false; code: VoiceRecorderErrorCode }
  > {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return { ok: false, code: "mic_unsupported" };
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Permesso negato, nessun microfono disponibile, dispositivo occupato…
      // dal punto di vista dell'operatore è sempre "non posso registrare".
      return { ok: false, code: "mic_permission_denied" };
    }
    try {
      const supported = pickMimeType();
      mimeType = supported ?? "audio/webm";
      mediaRecorder = supported
        ? new MediaRecorder(stream, { mimeType: supported })
        : new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.start();
      return { ok: true };
    } catch {
      releaseStream();
      return { ok: false, code: "mic_recording_failed" };
    }
  }

  function stop(): Promise<VoiceRecorderResult | null> {
    return new Promise((resolve) => {
      const recorder = mediaRecorder;
      mediaRecorder = null;
      if (!recorder || recorder.state === "inactive") {
        releaseStream();
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        releaseStream();
        const capturedMimeType = mimeType;
        const blob = new Blob(chunks, { type: capturedMimeType });
        chunks = [];
        blobToBase64(blob)
          .then((base64) => resolve({ base64, mimeType: capturedMimeType }))
          .catch(() => resolve(null));
      };
      recorder.stop();
    });
  }

  function cancel(): void {
    try {
      mediaRecorder?.stop();
    } catch {
      /* no-op: si sta comunque rilasciando lo stream sotto */
    }
    mediaRecorder = null;
    chunks = [];
    releaseStream();
  }

  return { start, stop, cancel };
}
