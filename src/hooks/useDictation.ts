import { useCallback, useEffect, useRef, useState } from "react";

const MAX_LISTEN_MS = 60_000; // overall safety cap — never listen forever
const SILENCE_MS = 2_500;     // finish after this much quiet (tolerates mid-sentence pauses)

export const SPEECH_RECOGNITION_SUPPORTED =
  typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

// Hands-free dictation into a text field — appends to whatever's already
// there rather than overwriting it, and auto-stops after a pause so the
// tradie doesn't have to tap again. This is deliberately simpler than
// VoiceMode.tsx (no text-to-speech reply, no submit-on-finish): it just
// fills the field for the tradie to glance over and correct before sending.
export function useDictation(getBaseText: () => string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseRef = useRef("");
  const accumulatedRef = useRef("");
  const sessionFinalRef = useRef("");
  const wantListeningRef = useRef(false);
  const listenStartRef = useRef(0);
  const hardCapRef = useRef<number | null>(null);
  const silenceRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (hardCapRef.current !== null) { clearTimeout(hardCapRef.current); hardCapRef.current = null; }
    if (silenceRef.current !== null) { clearTimeout(silenceRef.current); silenceRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    clearTimers();
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, [clearTimers]);

  const start = useCallback(() => {
    if (!SPEECH_RECOGNITION_SUPPORTED) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-AU";

    // Reset the silence countdown whenever we hear speech; once it elapses
    // with nothing new, treat the tradie as finished talking.
    const bumpSilence = () => {
      if (silenceRef.current !== null) clearTimeout(silenceRef.current);
      silenceRef.current = window.setTimeout(() => stop(), SILENCE_MS);
    };

    recognition.onstart = () => { setListening(true); bumpSilence(); };

    recognition.onresult = (event: any) => {
      let sessionFinal = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) sessionFinal += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      sessionFinalRef.current = sessionFinal;
      const combined = `${baseRef.current} ${accumulatedRef.current} ${sessionFinal} ${interim}`.replace(/\s+/g, " ").trim();
      onText(combined);
      bumpSilence();
    };

    recognition.onend = () => {
      // Fold this session's finalised text into the running transcript.
      accumulatedRef.current = `${accumulatedRef.current} ${sessionFinalRef.current}`.replace(/\s+/g, " ").trim();
      sessionFinalRef.current = "";

      // iOS ends the engine after a single utterance — if we're still meant
      // to be listening and under the cap, just restart it.
      if (wantListeningRef.current && Date.now() - listenStartRef.current < MAX_LISTEN_MS) {
        try { recognition.start(); return; } catch { /* fall through to finish */ }
      }
      clearTimers();
      setListening(false);
    };

    recognition.onerror = (e: any) => {
      // "no-speech"/"aborted" are benign mid-session; only give up on real errors.
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") {
        wantListeningRef.current = false;
        clearTimers();
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    baseRef.current = getBaseText().trim();
    accumulatedRef.current = "";
    sessionFinalRef.current = "";
    wantListeningRef.current = true;
    listenStartRef.current = Date.now();
    hardCapRef.current = window.setTimeout(() => stop(), MAX_LISTEN_MS);
    recognition.start();
  }, [getBaseText, onText, stop, clearTimers]);

  const toggle = useCallback(() => {
    if (listening) stop(); else start();
  }, [listening, start, stop]);

  useEffect(() => () => {
    wantListeningRef.current = false;
    clearTimers();
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
  }, [clearTimers]);

  return { listening, toggle };
}
