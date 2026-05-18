import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Calculator, BookOpen, GraduationCap, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import BottomNav from "./BottomNav";

const NAV_TABS = [
  { path: "/tools", icon: Calculator, label: "Tools" },
  { path: "/standards", icon: BookOpen, label: "Standards" },
  { path: "/learn", icon: GraduationCap, label: "Learn" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/profile", icon: User, label: "Profile" },
];

const AppLayout = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="h-dvh flex overflow-hidden relative" style={{ background: 'linear-gradient(to right, #FFFFFF, #FFE8E8)' }}>
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
      <aside className="hidden md:flex flex-col w-56 flex-shrink-0 border-r border-border bg-white/80 backdrop-blur-sm z-40 relative">
        <div className="px-5 py-5 border-b border-border flex-shrink-0">
          <h1 className="text-[24px] font-bold tracking-[-0.02em] leading-tight">
            <span className="text-foreground">Stand</span>
            <span className="text-primary">A</span>
            <span className="text-primary">I</span>
            <span className="text-foreground">d</span>
          </h1>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_TABS.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path || location.pathname.startsWith(path + "/");
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={cn(
                  "flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className={cn("h-5 w-5 flex-shrink-0", isActive && "stroke-[2.5]")} />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile header only */}
        <header
          className={`md:hidden flex-shrink-0 z-40 px-5 py-3 transition-all duration-300 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          } ${
            scrolled
              ? "bg-[#F7F5F2]/[0.87] backdrop-blur-[20px] border-b"
              : "bg-transparent border-b border-transparent"
          }`}
        >
          <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">
            <span className="text-foreground">Stand</span>
            <span className="text-primary">A</span>
            <span className="text-primary">I</span>
            <span className="text-foreground">d</span>
          </h1>
        </header>

        <main className="relative z-10 flex-1 overflow-hidden flex flex-col">
          <Outlet />
        </main>

        <BottomNav />
      </div>
    </div>
  );
};

export default AppLayout;
