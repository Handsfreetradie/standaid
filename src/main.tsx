import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { initSentry } from "./lib/sentry.ts";
import "./index.css";

// Initialize error tracking
initSentry();

// How often to explicitly ask the browser to re-check for a new service
// worker while the app stays open. registerType "autoUpdate" (vite.config.ts)
// already means any update found gets applied automatically, no prompt — but
// browsers only check for one on their own at certain points (page load,
// navigation), which a tradie who opens the installed PWA once and leaves it
// running all day on site may never hit again until they force-close it.
// This closes that gap so a deploy still reaches an already-open session.
const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Registers the app's single service worker (app-shell caching for the
// installable PWA + offline PDF caching). registerType "autoUpdate" in
// vite.config.ts means a new deploy is picked up and applied automatically.
registerSW({
  immediate: true,
  onRegisteredSW(_swScriptUrl, registration) {
    if (!registration) return;
    setInterval(() => {
      // Skips the check itself while offline rather than letting a failed
      // fetch surface as a console error with nothing anyone can do about it.
      if (navigator.onLine) void registration.update();
    }, SW_UPDATE_CHECK_INTERVAL_MS);
  },
});

createRoot(document.getElementById("root")!).render(<App />);
