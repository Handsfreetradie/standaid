import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Calculator, BookOpen, GraduationCap, MessageSquare, User, ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import BottomNav from "./BottomNav";
import { ProgressBar } from "./ProgressBar";
import { AiDisclaimerNotice } from "./AiDisclaimerNotice";

// Remembered per browser, not per account — a purely local screen-space
// preference, same reasoning as any other localStorage UI toggle in the app.
const NAV_COLLAPSED_KEY = "standaid-nav-collapsed";
const NAV_WIDTH_KEY = "standaid-nav-width";
const NAV_WIDTH_DEFAULT = 224; // 14rem, matches the old fixed w-56
const NAV_WIDTH_MIN = 180;
const NAV_WIDTH_MAX = 340;

const NAV_TABS = [
  { path: "/tools", icon: Calculator, label: "Tools" },
  { path: "/audits", icon: ClipboardCheck, label: "Audit" },
  { path: "/standards", icon: BookOpen, label: "Documents" },
  { path: "/learn", icon: GraduationCap, label: "Learn" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/profile", icon: User, label: "Profile" },
];

const AppLayout = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleNavCollapsed = () => {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      } catch {
        // Private browsing or storage disabled — the toggle still works
        // for this session, it just won't be remembered next visit.
      }
      return next;
    });
  };

  // Drag-to-resize the expanded sidebar's width, clamped to a sane range and
  // remembered the same way its collapsed state is. Not resizable while
  // collapsed — there's nothing to resize on an icon-only rail.
  const [navWidth, setNavWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(NAV_WIDTH_KEY));
      return stored >= NAV_WIDTH_MIN && stored <= NAV_WIDTH_MAX ? stored : NAV_WIDTH_DEFAULT;
    } catch {
      return NAV_WIDTH_DEFAULT;
    }
  });
  const [isResizingNav, setIsResizingNav] = useState(false);
  const navResizeDrag = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);
  const handleNavResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    navResizeDrag.current = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: navWidth };
    setIsResizingNav(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const handleNavResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = navResizeDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const next = Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, drag.startWidth + (e.clientX - drag.startClientX)));
    setNavWidth(next);
  };
  const handleNavResizeEnd = () => {
    if (!navResizeDrag.current) return;
    navResizeDrag.current = null;
    setIsResizingNav(false);
    try {
      localStorage.setItem(NAV_WIDTH_KEY, String(navWidth));
    } catch {
      // Private browsing or storage disabled — still works this session.
    }
  };

  return (
    <>
      <AiDisclaimerNotice />
      <ProgressBar />
      <div className="fixed inset-0 flex overflow-hidden" style={{ background: 'linear-gradient(to right, #FFFFFF, #FFE8E8)' }}>
      {/* SVG Noise texture overlay */}
      <svg className="noise-overlay" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>

      {/* Dot grid overlay */}
      <div className="dot-grid-overlay" />

      {/* Sidebar — desktop only */}
      <aside
        className={cn(
          "hidden md:flex flex-col flex-shrink-0 border-r border-border bg-white/80 backdrop-blur-sm z-40 relative",
          !isResizingNav && "transition-[width] duration-200"
        )}
        style={{ width: navCollapsed ? 64 : navWidth }}
      >
        <div className={cn("py-5 border-b border-border flex-shrink-0", navCollapsed ? "px-2 flex justify-center" : "px-5")}>
          <button onClick={() => navigate("/")} className="text-left" title="StandAId">
            {navCollapsed ? (
              // The app's own icon (public/apple-touch-icon.png — same image
              // used for the home-screen/PWA icon) rather than a letter, so
              // the collapsed rail shows a real StandAId mark.
              <img src="/apple-touch-icon.png" alt="StandAId" className="h-8 w-8 rounded-lg" />
            ) : (
              <h1 className="text-[24px] font-bold tracking-[-0.02em] leading-tight">
                <span className="text-foreground">Stand</span>
                <span className="text-primary">A</span>
                <span className="text-primary">I</span>
                <span className="text-foreground">d</span>
              </h1>
            )}
          </button>
        </div>
        <nav className={cn("flex-1 py-4 space-y-1 overflow-y-auto", navCollapsed ? "px-2" : "px-3")}>
          {NAV_TABS.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path || location.pathname.startsWith(path + "/");
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                title={navCollapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-xl text-sm font-medium transition-colors",
                  navCollapsed ? "w-full justify-center py-2.5" : "gap-3 w-full px-3 py-2.5",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className={cn("h-5 w-5 flex-shrink-0", isActive && "stroke-[2.5]")} />
                {!navCollapsed && label}
              </button>
            );
          })}
        </nav>
        <button
          onClick={toggleNavCollapsed}
          title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex items-center justify-center gap-2 py-3 border-t border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
        >
          {navCollapsed ? <ChevronRight className="h-4 w-4" /> : (
            <>
              <ChevronLeft className="h-4 w-4" /> Collapse
            </>
          )}
        </button>
        {!navCollapsed && (
          <div
            onPointerDown={handleNavResizeStart}
            onPointerMove={handleNavResizeMove}
            onPointerUp={handleNavResizeEnd}
            className="absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/50"
            title="Drag to resize"
          />
        )}
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile header only */}
        <header
          className={`md:hidden flex-shrink-0 z-40 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] transition-all duration-300 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          } ${
            scrolled
              ? "bg-[#F7F5F2]/[0.87] backdrop-blur-[20px] border-b"
              : "bg-transparent border-b border-transparent"
          }`}
        >
          <button onClick={() => navigate("/")} className="text-left">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">
              <span className="text-foreground">Stand</span>
              <span className="text-primary">A</span>
              <span className="text-primary">I</span>
              <span className="text-foreground">d</span>
            </h1>
          </button>
        </header>

        <main className="relative z-10 flex-1 overflow-y-auto flex flex-col md:overflow-hidden">
          <Outlet />
        </main>

        <BottomNav />
      </div>
    </div>
    </>
  );
};

export default AppLayout;
