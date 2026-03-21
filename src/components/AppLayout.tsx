import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";

const AppLayout = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* StandAId Logo Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border px-5 py-3">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight leading-tight">
          <span className="text-foreground">Stand</span>
          <span className="text-primary">A</span>
          <span className="text-primary">I</span>
          <span className="text-foreground">d</span>
        </h1>
      </header>
      <main className="pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
};

export default AppLayout;
