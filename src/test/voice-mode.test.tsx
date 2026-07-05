import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import VoiceMode from "../components/VoiceMode";

// Tap the mic button (the large control) to start dictation — this is what
// attaches the recognition handlers in the component.
function tapMic() {
  const buttons = screen.getAllByRole("button");
  // [0] = close (X), [1] = mic
  fireEvent.click(buttons[buttons.length - 1]);
}

// Minimal mock of the Web Speech API that lets tests drive the exact event
// sequence a real engine produces — including iOS Safari ending a session
// mid-dictation (which the old code treated as "user finished").
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  started = false;

  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    this.onend?.();
  }
  // Test helper: emit a result event shaped like the real API
  emit(finalText: string, interimText = "") {
    const shaped: any[] = [];
    if (finalText) shaped.push({ isFinal: true, 0: { transcript: finalText } });
    if (interimText) shaped.push({ isFinal: false, 0: { transcript: interimText } });
    this.onresult?.({ results: shaped });
  }
}

let mockRec: MockSpeechRecognition;

beforeEach(() => {
  vi.useFakeTimers();
  mockRec = new MockSpeechRecognition();
  (window as any).SpeechRecognition = vi.fn(() => mockRec);
  (window as any).webkitSpeechRecognition = (window as any).SpeechRecognition;
  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
  (window as any).SpeechSynthesisUtterance = vi.fn(() => ({}));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VoiceMode dictation", () => {
  it("captures the full sentence even when the engine cuts out mid-speech (iOS pattern)", async () => {
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<VoiceMode onTranscript={onTranscript} isQuerying={false} onClose={onClose} />);

    // Start listening (mic tap → startListening runs recognition.start())
    act(() => { tapMic(); });

    // User says the first half
    act(() => { mockRec.emit("what is the maximum") });
    // iOS ends the session mid-sentence after a short pause
    await act(async () => { mockRec.stop(); });
    // Engine restarts automatically — user finishes the sentence
    act(() => { mockRec.emit("demand for a house") });

    // Genuine silence → the silence timer fires and finishes for good
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });

    expect(onTranscript).toHaveBeenCalledTimes(1);
    const submitted = onTranscript.mock.calls[0][0];
    expect(submitted).toBe("what is the maximum demand for a house");
  });

  it("does not submit on a brief mid-sentence pause", async () => {
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    render(<VoiceMode onTranscript={onTranscript} isQuerying={false} onClose={vi.fn()} />);
    act(() => { tapMic(); });
    act(() => { mockRec.emit("what is") });
    // Only 1s of quiet — a natural pause, should NOT finish
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onTranscript).not.toHaveBeenCalled();
    // User continues, then goes properly quiet
    act(() => { mockRec.emit("what is the rule") });
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(onTranscript).toHaveBeenCalledWith("what is the rule");
  });
});
