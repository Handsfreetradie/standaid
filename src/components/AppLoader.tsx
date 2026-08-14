// Branded loading state — the real shield app icon (pwa-192.png, not a
// redrawn copy, so it can never drift out of sync with the actual logo)
// with a gentle breathing pulse. Used everywhere the app would otherwise
// show a blank screen or a generic spinner while auth/session state
// resolves.
export function AppLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <img
        src="/pwa-192.png"
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 rounded-2xl animate-shield-pulse"
      />
    </div>
  );
}
