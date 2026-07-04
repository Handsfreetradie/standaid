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

const MAX_LISTEN_MS = 30_000; // safety net — never listen forever

const VoiceMode = ({ onTranscript, isQuerying, onClose }: VoiceModeProps) => {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Refs so the recognition callbacks always see current values — the old
  // implementation captured a stale (empty) transcript in onend, which made
  // the overlay hang after speaking instead of submitting the question.
  const transcriptRef = useRef("");
  const listenTimeoutRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const clearListenTimeout = useCallback(() => {
    if (listenTimeoutRef.current !== null) {
      clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearListenTimeout();
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, [clearListenTimeout]);

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
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-AU";

    recognition.onstart = () => {
      setState("listening");
      setTranscript("");
      transcriptRef.current = "";
      setAiResponse("");
      // Hard stop if the engine never ends on its own (seen on some phones)
      clearListenTimeout();
      listenTimeoutRef.current = window.setTimeout(() => {
        try { recognition.stop(); } catch { /* noop */ }
      }, MAX_LISTEN_MS);
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      const text = finalTranscript || interimTranscript;
      setTranscript(text);
      transcriptRef.current = text;
      // Once we have a final result, stop straight away — don't leave the mic
      // hanging open waiting for the engine's own silence detection.
      if (finalTranscript) {
        try { recognition.stop(); } catch { /* noop */ }
      }
    };

    recognition.onend = async () => {
      clearListenTimeout();
      const finalText = transcriptRef.current;
      if (!finalText.trim()) {
        setState("idle");
        return;
      }
      setState("processing");
      try {
        const response = await onTranscript(finalText);
        if (closedRef.current) return;
        if (response) {
          setAiResponse(response);
          speak(response);
        } else {
          // Question was submitted — return to the chat to read the result
          onClose();
        }
      } catch {
        if (!closedRef.current) onClose();
      }
    };

    recognition.onerror = () => {
      clearListenTimeout();
      setState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onTranscript, speak, onClose, clearListenTimeout]);

  useEffect(() => {
    return () => {
      closedRef.current = true;
      clearListenTimeout();
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      window.speechSynthesis.cancel();
    };
  }, [clearListenTimeout]);

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
        {state === "listening" && "Listening..."}
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
