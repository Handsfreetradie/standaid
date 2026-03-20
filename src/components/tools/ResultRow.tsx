import { cn } from "@/lib/utils";

interface ResultRowProps {
  label: string;
  value: string | number;
  unit?: string;
  variant?: "default" | "primary" | "destructive" | "warning";
  size?: "sm" | "lg";
}

const ResultRow = ({ label, value, unit, variant = "default", size = "lg" }: ResultRowProps) => {
  const colorClass = {
    default: "text-foreground",
    primary: "text-primary",
    destructive: "text-destructive",
    warning: "text-orange-600 dark:text-orange-400",
  }[variant];

  return (
    <div>
      <p className={cn(size === "lg" ? "text-2xl" : "text-lg", "font-extrabold", colorClass)}>
        {value}{unit && <span className="text-sm font-bold ml-0.5">{unit}</span>}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
};

export default ResultRow;
