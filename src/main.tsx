import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { initSentry } from "./lib/sentry.ts";
import "./index.css";

// Initialize error tracking
initSentry();

// Registers the app's single service worker (app-shell caching for the
// installable PWA + offline PDF caching). registerType "autoUpdate" in
// vite.config.ts means a new deploy is picked up and applied automatically.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
