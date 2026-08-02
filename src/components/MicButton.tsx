import { useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation, SPEECH_RECOGNITION_SUPPORTED } from "@/hooks/useDictation";

interface MicButtonProps {
  value: string;
  onChange: (text: string) => void;
  className?: string;
}

// Hands-free dictation toggle for a text field — reuses the same free
// browser Web Speech API as Chat's voice mode, just without the full
// conversational overlay: it fills the field, the tradie checks it before
// sending. Renders nothing on browsers that don't support it.
const MicButton = ({ value, onChange, className }: MicButtonProps) => {
  const valueRef = useRef(value);
  valueRef.current = value;
  const { listening, toggle } = useDictation(() => valueRef.current, onChange);

  if (!SPEECH_RECOGNITION_SUPPORTED) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Stop dictating" : "Dictate"}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
        listening ? "border-destructive bg-destructive/10 text-destructive animate-pulse" : "border-border text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
    </button>
  );
};

export default MicButton;
