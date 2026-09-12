import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  useSetoutVoiceNotes,
  useCreateSetoutVoiceNote,
  useTranscribeSetoutVoiceNote,
  useDeleteSetoutVoiceNote,
} from "@/hooks/useSetoutVoiceNotes";
import type { SetoutVoiceNote } from "@/lib/setoutTypes";

interface VoiceNotesPanelProps {
  planId: string;
}

// A hard ceiling on a single recording — this is a real per-minute
// transcription cost (Deepgram), not just a UX nicety. Bounds the worst
// case per note to a calculable number rather than a tradie's phone
// recording all day in a forgotten pocket.
const MAX_RECORDING_SECONDS = 20 * 60;

// Priority order: opus-in-webm (Chrome/Android) first since it's the
// smallest/cheapest, then plain webm, then mp4/AAC (iOS Safari — MediaRecorder
// there doesn't support webm at all), then ogg as a last resort. Whichever
// one the browser actually supports is what gets recorded AND what's sent
// to Deepgram as the real Content-Type — never assumed.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VoiceNotesPanel({ planId }: VoiceNotesPanelProps) {
  const { user } = useAuth();
  const { data: notes = [], isLoading } = useSetoutVoiceNotes(planId);
  const createNote = useCreateSetoutVoiceNote(planId);
  const transcribeNote = useTranscribeSetoutVoiceNote(planId);
  const deleteNote = useDeleteSetoutVoiceNote(planId);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Belt-and-braces: release the mic and clear timers if the panel unmounts
  // mid-recording (e.g. the tradie closes the dialog) rather than leaving
  // the browser's mic indicator on forever.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    };
  }, []);

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const startRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Couldn't access the microphone — check the browser's permission for this site.");
      return;
    }
    const mimeType = pickSupportedMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
    chunksRef.current = [];
    streamRef.current = stream;
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      setRecording(false);

      const blob = new Blob(chunksRef.current, { type: actualMimeType });
      const durationSeconds = elapsed;
      setElapsed(0);
      if (blob.size === 0 || !user) return;

      setUploading(true);
      try {
        const path = `${user.id}/${planId}/${crypto.randomUUID()}.${extensionFor(actualMimeType)}`;
        const { error: uploadError } = await supabase.storage
          .from("setout-voice-notes")
          .upload(path, blob, { contentType: actualMimeType });
        if (uploadError) throw uploadError;

        const created = await createNote.mutateAsync({ storage_path: path, content_type: actualMimeType, duration_seconds: durationSeconds });
        setTranscribingId(created.id);
        try {
          await transcribeNote.mutateAsync(created.id);
        } finally {
          setTranscribingId(null);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save the recording");
      } finally {
        setUploading(false);
      }
    };

    recorder.start();
    setRecording(true);
    setElapsed(0);
    intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    autoStopRef.current = setTimeout(() => {
      toast.info("Stopped automatically at 20 minutes.");
      stopRecording();
    }, MAX_RECORDING_SECONDS * 1000);
  };

  const handleRetry = async (note: SetoutVoiceNote) => {
    setTranscribingId(note.id);
    try {
      await transcribeNote.mutateAsync(note.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setTranscribingId(null);
    }
  };

  const handleDelete = async (note: SetoutVoiceNote) => {
    setDeletingId(note.id);
    try {
      await deleteNote.mutateAsync(note);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the note");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      <Card className="p-4 rounded-xl flex flex-col items-center gap-3">
        {recording ? (
          <>
            <p className="text-2xl font-mono font-bold text-destructive tabular-nums">{formatElapsed(elapsed)}</p>
            <p className="text-xs text-muted-foreground">Recording — auto-stops at 20:00</p>
            <Button variant="destructive" className="gap-1.5" onClick={stopRecording}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          </>
        ) : (
          <>
            <Button className="gap-1.5" disabled={uploading} onClick={startRecording}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {uploading ? "Saving…" : "Record walkthrough note"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              General narration about the job — not pinned to a spot on the plan. Transcribed automatically.
            </p>
          </>
        )}
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No voice notes yet.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <Card key={note.id} className="p-3 rounded-xl">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {new Date(note.created_at).toLocaleString()}
                    {note.duration_seconds != null && ` · ${formatElapsed(Math.round(note.duration_seconds))}`}
                  </p>
                  {transcribingId === note.id || note.status === "transcribing" ? (
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…
                    </p>
                  ) : note.status === "failed" ? (
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-sm text-destructive">Transcription failed</p>
                      <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => handleRetry(note)}>
                        <RotateCcw className="h-3 w-3" /> Retry
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-foreground mt-1">{note.transcript || "—"}</p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => handleDelete(note)}
                  disabled={deletingId === note.id}
                >
                  {deletingId === note.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
