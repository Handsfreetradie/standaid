// Sentry integration for error tracking. Initialize early in main.tsx.
// Captures unhandled errors, console.error, and custom events.

export function initSentry() {
  const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
  if (!SENTRY_DSN) {
    console.warn("Sentry DSN not configured — error tracking disabled");
    return;
  }

  // Minimal Sentry setup without the full SDK (keeps bundle smaller).
  // Sends errors to your Sentry project.
  window.addEventListener("error", (event) => {
    sendToSentry({
      level: "error",
      message: event.message,
      stack: event.error?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    sendToSentry({
      level: "error",
      message: `Unhandled Promise: ${event.reason}`,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  sendToSentry({
    level: "error",
    message,
    stack,
    url: window.location.href,
    context,
    userAgent: navigator.userAgent,
  });
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info", context?: Record<string, unknown>) {
  sendToSentry({
    level,
    message,
    url: window.location.href,
    context,
    userAgent: navigator.userAgent,
  });
}

interface SentryEvent {
  level: string;
  message: string;
  stack?: string;
  url: string;
  userAgent: string;
  context?: Record<string, unknown>;
}

function sendToSentry(event: SentryEvent) {
  const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
  if (!SENTRY_DSN) return;

  // Parse DSN to extract project ID and key
  const dsnUrl = new URL(SENTRY_DSN);
  const projectId = dsnUrl.pathname.split("/").pop();

  // Send via fetch (async, won't block the app)
  fetch(`${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/store/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_key=${dsnUrl.username}, sentry_version=7`,
    },
    body: JSON.stringify({
      event_id: crypto.randomUUID(),
      timestamp: Date.now() / 1000,
      level: event.level,
      message: { message: event.message },
      exception: event.stack ? [{ value: event.message, stacktrace: { frames: [{ filename: event.url, lineno: 0 }] } }] : undefined,
      request: { url: event.url, headers: { "User-Agent": event.userAgent } },
      contexts: { app: event.context },
    }),
  }).catch(() => {
    /* Sentry failed — don't break the app */
  });
}
