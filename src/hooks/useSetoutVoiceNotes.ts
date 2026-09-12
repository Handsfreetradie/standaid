import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SetoutVoiceNote } from "@/lib/setoutTypes";

// setout_* tables are newer than the generated Supabase types — same `as any`
// escape hatch used elsewhere in this repo (e.g. useSetoutCircuits.ts) for
// tables ahead of a type regen.
const sb = supabase as any;

export function useSetoutVoiceNotes(planId: string | undefined) {
  return useQuery({
    queryKey: ["setout_voice_notes", planId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("setout_voice_notes")
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SetoutVoiceNote[];
    },
    enabled: !!planId,
  });
}

export function useCreateSetoutVoiceNote(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { storage_path: string; content_type: string; duration_seconds?: number }) => {
      const { data, error } = await sb
        .from("setout_voice_notes")
        .insert({
          plan_id: planId,
          storage_path: input.storage_path,
          content_type: input.content_type,
          duration_seconds: input.duration_seconds ?? null,
          status: "pending",
        })
        .select()
        .single();
      if (error) throw error;
      return data as SetoutVoiceNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_voice_notes", planId] });
    },
  });
}

// Calls the transcribe-setout-voice-note edge function, which downloads the
// audio, calls Deepgram server-side (the API key never reaches the client),
// and writes transcript/status back onto the row itself — this mutation's
// own onSuccess just refetches the list to pick that up. Deepgram's
// pre-recorded endpoint is synchronous, so a completed call already means
// "done or failed", not "queued".
export function useTranscribeSetoutVoiceNote(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (voiceNoteId: string) => {
      const { data, error } = await supabase.functions.invoke("transcribe-setout-voice-note", {
        body: { voice_note_id: voiceNoteId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_voice_notes", planId] });
    },
  });
}

// Deletes the row first (source of truth for what shows on the plan), then
// best-effort removes the storage file — same ordering/reasoning as
// useDeleteSetoutPhotoPoint.
export function useDeleteSetoutVoiceNote(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (voiceNote: SetoutVoiceNote) => {
      const { error } = await sb.from("setout_voice_notes").delete().eq("id", voiceNote.id);
      if (error) throw error;
      await supabase.storage.from("setout-voice-notes").remove([voiceNote.storage_path]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setout_voice_notes", planId] });
    },
  });
}
