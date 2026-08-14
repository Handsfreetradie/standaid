import { Calculator, BookOpen, MessageSquare, User, GraduationCap, ClipboardCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const tabs = [
  { path: "/tools", icon: Calculator, label: "Tools" },
  { path: "/audits", icon: ClipboardCheck, label: "Audit" },
  { path: "/standards", icon: BookOpen, label: "Standards" },
  { path: "/learn", icon: GraduationCap, label: "Learn" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/profile", icon: User, label: "Profile" },
];

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="md:hidden flex-shrink-0 z-50 border-t border-border bg-white pb-safe overflow-x-hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around pt-2 pb-0 w-full">
        {tabs.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path || location.pathname.startsWith(path + "/");
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs font-medium transition-colors min-w-[56px] min-h-[44px] justify-center flex-1",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
