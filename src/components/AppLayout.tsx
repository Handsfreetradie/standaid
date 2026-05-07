import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import BottomNav from "./BottomNav";

const AppLayout = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="h-dvh flex flex-col overflow-hidden relative" style={{ background: 'linear-gradient(to right, #FFFFFF, #FFE8E8)' }}>
      {/* SVG Noise texture overlay */}
      <svg className="noise-overlay" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>

      {/* Dot grid overlay */}
      <div className="dot-grid-overlay" />

      {/* Navbar */}
      <header
        className={`flex-shrink-0 z-40 px-5 py-3 transition-all duration-300 ${
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
  );
};

export default AppLayout;
