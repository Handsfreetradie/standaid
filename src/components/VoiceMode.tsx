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

const VoiceMode = ({ onTranscript, isQuerying, onClose }: VoiceModeProps) => {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setState("idle");
  }, []);

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => setState("idle");
    utterance.onerror = () => setState("idle");
    synthRef.current = utterance;
    setState("speaking");
    window.speechSynthesis.speak(utterance);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setAiResponse("Voice recognition is not supported in this browser. Please try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-AU";

    recognition.onstart = () => {
      setState("listening");
      setTranscript("");
      setAiResponse("");
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
      setTranscript(finalTranscript || interimTranscript);
    };

    recognition.onend = async () => {
      // Get the final transcript from state via a ref trick
      const finalText = transcript;
      if (!finalText.trim()) {
        setState("idle");
        return;
      }
      setState("processing");
      try {
        const response = await onTranscript(finalText);
        if (response) {
          setAiResponse(response);
          speak(response);
        } else {
          setState("idle");
        }
      } catch {
        setState("idle");
      }
    };

    recognition.onerror = () => {
      setState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onTranscript, speak, transcript]);

  // We need to handle the transcript in onend properly
  // Use a ref to track the latest transcript
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognition.onend = async () => {
      const finalText = transcriptRef.current;
      if (!finalText.trim()) {
        setState("idle");
        return;
      }
      setState("processing");
      try {
        const response = await onTranscript(finalText);
        if (response) {
          setAiResponse(response);
          speak(response);
        } else {
          setState("idle");
        }
      } catch {
        setState("idle");
      }
    };
  }, [onTranscript, speak]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis.cancel();
    };
  }, []);

  const handleMicClick = () => {
    if (state === "listening") {
      stopListening();
    } else if (state === "speaking") {
      stopSpeaking();
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
