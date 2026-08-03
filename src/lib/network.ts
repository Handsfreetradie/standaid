// Network resilience: auto-retry with exponential backoff, timeout handling, user-friendly errors.

export class NetworkError extends Error {
  constructor(
    public code: string,
    message: string,
    public retriesLeft: number = 0,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

// HTTP errors in this set won't succeed on retry — the request itself is the
// problem (bad input, no permission, rate-limited), not a dropped connection.
// Retrying and then reporting "check your internet" on these was actively
// misleading users whose connection was fine.
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 429]);

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, timeoutMs = 30000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new NetworkError("TIMEOUT", `Operation timed out after ${timeoutMs}ms`, maxRetries - attempt)), timeoutMs),
        ),
      ]);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const status = (lastError as { status?: number }).status;
      if (status !== undefined && NON_RETRYABLE_STATUSES.has(status)) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  if (lastError instanceof NetworkError) {
    lastError.retriesLeft = 0;
    throw lastError;
  }
  // Preserve the real failure instead of replacing it with a generic message —
  // retries were exhausted, but the cause (server error, malformed response,
  // etc.) is still whatever lastError says, and the user shouldn't be told
  // it's their internet connection when it isn't.
  throw lastError ?? new NetworkError("FAILED", `Operation failed after ${maxRetries + 1} attempts`, 0);
}

// Human-friendly error messages for common failures.
export function getUserMessage(error: unknown): string {
  if (error instanceof NetworkError) {
    if (error.code === "TIMEOUT") return "The operation took too long — check your connection and try again.";
    if (error.code === "FAILED") return "Lost connection — please check your internet and try again.";
  }

  // Check the real HTTP status first — the server's error message doesn't
  // always spell out the status code as a substring (e.g. "Daily limit
  // reached" for a 429), so relying on msg.includes() alone missed these.
  const status = (error as { status?: number })?.status;
  if (status === 401) return "Your session expired — please sign in again.";
  if (status === 403) return "You don't have permission for that.";
  if (status === 404) return "That resource wasn't found.";
  if (status === 429) return "StandAId is currently experiencing problems, try again later.";
  if (status !== undefined && status >= 500) return "Server error — we're looking into it. Try again in a moment.";

  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("401")) return "Your session expired — please sign in again.";
  if (msg.includes("403")) return "You don't have permission for that.";
  if (msg.includes("404")) return "That resource wasn't found.";
  if (msg.includes("429")) return "StandAId is currently experiencing problems, try again later.";
  if (msg.includes("500")) return "Server error — we're looking into it. Try again in a moment.";

  if (msg.includes("network")) return "Lost connection — check your internet and try again.";
  if (msg.includes("timeout")) return "Operation timed out — check your connection and retry.";

  return "Something went wrong — please try again.";
}

// Stream parser for Server-Sent Events (used by /query endpoint).
export async function parseSSEStream(response: Response): Promise<Map<string, unknown>> {
  if (!response.body) throw new Error("No response body");

  const events = new Map<string, unknown>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);
          if (event.queryId) events.set("queryId", event.queryId);
          if (event.done) {
            if (event.answer) events.set("answer", event.answer);
            if (event.citations) events.set("citations", event.citations);
            events.set("done", true);
            return events;
          }
          if (event.token) {
            const prev = (events.get("tokens") as string[]) || [];
            events.set("tokens", [...prev, event.token]);
          }
          if (event.error) throw new Error(event.error);
        } catch (e) {
          console.warn("SSE parse error (non-fatal):", e);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new NetworkError("STREAM_INCOMPLETE", "Stream ended before completion", 0);
}
