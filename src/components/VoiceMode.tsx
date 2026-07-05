import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Volume2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceModeProps {
  onTranscript: (text: string) => Promise<string | undefined>;
  isQuerying: boolean;
  onClose: () => void;
}

type VoiceState = "idle" | "listening" | "processing" | "speaking";

const MAX_LISTEN_MS = 60_000;  // overall safety cap — never listen forever
const SILENCE_MS = 2_500;      // finish after this much quiet (tolerates mid-sentence pauses)

const VoiceMode = ({ onTranscript, isQuerying, onClose }: VoiceModeProps) => {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Refs so the recognition callbacks always see current values (no stale closures).
  const transcriptRef = useRef("");
  // Confirmed text from previous recognition sessions. iOS Safari (and to a
  // lesser extent others) ends a session after a single utterance, so we
  // accumulate finals here and restart the engine to keep dictating.
  const accumulatedRef = useRef("");
  const sessionFinalRef = useRef("");   // finals within the CURRENT session
  const wantListeningRef = useRef(false); // true while the user still wants to talk
  const listenStartRef = useRef(0);
  const hardCapRef = useRef<number | null>(null);
  const silenceRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (hardCapRef.current !== null) { clearTimeout(hardCapRef.current); hardCapRef.current = null; }
    if (silenceRef.current !== null) { clearTimeout(silenceRef.current); silenceRef.current = null; }
  }, []);

  // Finish for good: stop wanting to listen, then stop the engine so onend
  // finalises and submits.
  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    clearTimers();
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, [clearTimers]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setState("idle");
  }, []);

  // After the answer finishes speaking, hand back to the chat screen so the
  // user can read their question and the full answer.
  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => { if (!closedRef.current) onClose(); };
    utterance.onerror = () => { if (!closedRef.current) onClose(); };
    synthRef.current = utterance;
    setState("speaking");
    window.speechSynthesis.speak(utterance);
  }, [onClose]);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setAiResponse("Voice recognition is not supported in this browser. Please try Chrome or Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;      // keep going across pauses where supported
    recognition.interimResults = true;
    recognition.lang = "en-AU";

    // Reset the silence countdown — fired whenever we hear speech; when it
    // elapses with no new speech, we treat the user as finished.
    const bumpSilence = () => {
      if (silenceRef.current !== null) clearTimeout(silenceRef.current);
      silenceRef.current = window.setTimeout(() => stopListening(), SILENCE_MS);
    };

    recognition.onstart = () => {
      setState("listening");
      setAiResponse("");
      bumpSilence();
    };

    recognition.onresult = (event: any) => {
      let sessionFinal = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) sessionFinal += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      sessionFinalRef.current = sessionFinal;
      const combined = `${accumulatedRef.current} ${sessionFinal} ${interim}`.replace(/\s+/g, " ").trim();
      setTranscript(combined);
      transcriptRef.current = `${accumulatedRef.current} ${sessionFinal}`.replace(/\s+/g, " ").trim();
      bumpSilence(); // heard something → reset the quiet timer
    };

    recognition.onend = async () => {
      // Fold this session's finalised text into the running transcript.
      accumulatedRef.current = `${accumulatedRef.current} ${sessionFinalRef.current}`.replace(/\s+/g, " ").trim();
      sessionFinalRef.current = "";

      // If the user still wants to talk and we're under the cap, the engine
      // just auto-stopped (iOS does this per utterance) — restart it.
      if (wantListeningRef.current && Date.now() - listenStartRef.current < MAX_LISTEN_MS && !closedRef.current) {
        try { recognition.start(); return; } catch { /* fall through to finalise */ }
      }

      // Finished — submit whatever we captured.
      clearTimers();
      const finalText = accumulatedRef.current;
      transcriptRef.current = finalText;
      if (!finalText.trim()) { setState("idle"); return; }
      setState("processing");
      try {
        const response = await onTranscript(finalText);
        if (closedRef.current) return;
        if (response) { setAiResponse(response); speak(response); }
        else onClose(); // submitted — back to chat to read the result
      } catch {
        if (!closedRef.current) onClose();
      }
    };

    recognition.onerror = (e: any) => {
      // "no-speech"/"aborted" are benign mid-session; only give up on real errors.
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") {
        wantListeningRef.current = false;
        clearTimers();
        setAiResponse("Microphone unavailable — check the app has mic permission.");
        setState("idle");
      }
    };

    recognitionRef.current = recognition;
    accumulatedRef.current = "";
    sessionFinalRef.current = "";
    transcriptRef.current = "";
    setTranscript("");
    wantListeningRef.current = true;
    listenStartRef.current = Date.now();
    // Overall safety cap
    hardCapRef.current = window.setTimeout(() => stopListening(), MAX_LISTEN_MS);
    recognition.start();
  }, [onTranscript, speak, onClose, clearTimers, stopListening]);

  useEffect(() => {
    return () => {
      closedRef.current = true;
      wantListeningRef.current = false;
      clearTimers();
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      window.speechSynthesis.cancel();
    };
  }, [clearTimers]);

  const handleMicClick = () => {
    if (state === "listening") {
      stopListening();
    } else if (state === "speaking") {
      // Tap while speaking = "let me read it" — stop talking, back to chat
      window.speechSynthesis.cancel();
      onClose();
    } else if (state === "idle") {
      startListening();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-muted-foreground"
        onClick={() => {
          stopSpeaking();
          stopListening();
          onClose();
        }}
      >
        <X className="h-6 w-6" />
      </Button>

      {/* State label */}
      <p className="text-sm font-medium text-muted-foreground mb-8 uppercase tracking-wider">
        {state === "idle" && "Tap to speak"}
        {state === "listening" && "Listening… tap to send"}
        {state === "processing" && "Thinking..."}
        {state === "speaking" && "Speaking..."}
      </p>

      {/* Animated mic button */}
      <button
        onClick={handleMicClick}
        disabled={state === "processing"}
        className={cn(
          "relative flex h-28 w-28 items-center justify-center rounded-full transition-all duration-300",
          state === "idle" && "bg-primary text-primary-foreground hover:scale-105",
          state === "listening" && "bg-destructive text-destructive-foreground scale-110",
          state === "processing" && "bg-muted text-muted-foreground",
          state === "speaking" && "bg-primary/80 text-primary-foreground"
        )}
      >
        {/* Pulse rings for listening */}
        {state === "listening" && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-destructive/30" />
            <span className="absolute -inset-3 animate-pulse rounded-full border-2 border-destructive/20" />
          </>
        )}
        {state === "speaking" && (
          <span className="absolute -inset-3 animate-pulse rounded-full border-2 border-primary/20" />
        )}

        {state === "processing" ? (
          <Loader2 className="h-10 w-10 animate-spin" />
        ) : state === "speaking" ? (
          <Volume2 className="h-10 w-10" />
        ) : state === "listening" ? (
          <MicOff className="h-10 w-10" />
        ) : (
          <Mic className="h-10 w-10" />
        )}
      </button>

      {/* Transcript */}
      <div className="mt-10 max-w-sm px-6 text-center">
        {transcript && (
          <p className="text-base font-medium text-foreground mb-3">
            "{transcript}"
          </p>
        )}
        {aiResponse && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {aiResponse}
          </p>
        )}
      </div>
    </div>
  );
};

export default VoiceMode;
