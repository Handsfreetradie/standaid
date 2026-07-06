import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initSentry } from "./lib/sentry.ts";
import "./index.css";

// Initialize error tracking
initSentry();

// Register service worker for offline PDF access
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Service worker failed:", e));
}

createRoot(document.getElementById("root")!).render(<App />);
