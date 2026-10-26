import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";
import ResultRow from "./ResultRow";

type Section = "tray" | "tophat";
type TrayBend = "vert-in" | "vert-out" | "mitre" | "offset";
type HatBend = "vert-in" | "vert-out" | "mitre" | "flat";

interface Row { label: string; value: string; unit?: string }
interface Result {
  headline: { value: string; unit?: string; label: string };
  rows: Row[];
  steps: string[];
  warnings: string[];
  diagram: React.ReactNode;
}

interface Props { onBack: () => void }

const ANGLES = [15, 22.5, 30, 45, 60, 90];
const rad = (d: number) => (d * Math.PI) / 180;
const fmt = (n: number) => String(Math.round(n * 10) / 10);

// ---------- Diagrams (schematic, not to scale) ----------

const Svg = ({ children, h = 130 }: { children: React.ReactNode; h?: number }) => (
  <svg viewBox={`0 0 300 ${h}`} className="w-full h-auto text-foreground" role="img">{children}</svg>
);

const Txt = ({ x, y, children, anchor = "middle", primary = false }: { x: number; y: number; children: React.ReactNode; anchor?: "start" | "middle" | "end"; primary?: boolean }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize="10" fontWeight="600" fill={primary ? "hsl(var(--primary))" : "currentColor"}>{children}</text>
);

/** Side rail laid flat with the V-notches (or slits) marked on it. */
const NotchDiagram = ({ H, w, n, s, outside }: { H: number; w: number; n: number; s: number; outside: boolean }) => {
  const top = 34, bottom = 94, left = 12, right = 288;
  const ratio = H > 0 ? w / H : 1;
  const wpx = Math.min(54, Math.max(12, 60 * ratio));
  const gap = n > 1 ? Math.min(60, 200 / n) : 0;
  const cxs = Array.from({ length: n }, (_, i) => 150 + (i - (n - 1) / 2) * gap);
  return (
    <Svg>
      <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {cxs.map((cx, i) => outside ? (
        <g key={i}>
          <line x1={cx} y1={top} x2={cx} y2={bottom} stroke="hsl(var(--primary))" strokeWidth="2" />
          <polygon points={`${cx},${bottom} ${cx - wpx / 2},${top} ${cx + wpx / 2},${top}`} fill="none" stroke="hsl(var(--primary))" strokeWidth="1" strokeDasharray="3 2" />
        </g>
      ) : (
        <polygon key={i} points={`${cx},${bottom} ${cx - wpx / 2},${top} ${cx + wpx / 2},${top}`} fill="hsl(var(--primary) / 0.25)" stroke="hsl(var(--primary))" strokeWidth="1.5" />
      ))}
      <Txt x={150} y={22} primary>{fmt(w)} mm at top edge{n > 1 ? ` × ${n} cuts` : ""}</Txt>
      <Txt x={left + 2} y={bottom + 14} anchor="start">Base line (fold)</Txt>
      <Txt x={right - 2} y={(top + bottom) / 2 + 4} anchor="end">H {fmt(H)}</Txt>
      {n > 1 && s > 0 && <Txt x={150} y={bottom + 28}>cuts {fmt(s)} mm apart</Txt>}
    </Svg>
  );
};

/** Plan view of one tray length with the mitre cut line. */
const MitreDiagram = ({ W, L, theta }: { W: number; L: number; theta: number }) => {
  const y0 = 30, y1 = 90, h = y1 - y0;
  const d = Math.min(h * 1.6, h * Math.tan(rad(theta / 2)));
  const x = 190;
  return (
    <Svg>
      <rect x={20} y={y0} width={260} height={h} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <polygon points={`${x},${y0} ${x + d},${y1} ${x},${y1}`} fill="hsl(var(--primary) / 0.25)" stroke="none" />
      <line x1={x} y1={y0} x2={x + d} y2={y1} stroke="hsl(var(--primary))" strokeWidth="2" />
      <line x1={x} y1={y1 + 8} x2={x + d} y2={y1 + 8} stroke="currentColor" strokeWidth="1" />
      <Txt x={x + d / 2} y={y1 + 22} primary>{fmt(L)} mm</Txt>
      <Txt x={24} y={y0 + h / 2 + 4} anchor="start">W {fmt(W)}</Txt>
      <Txt x={150} y={20}>{fmt(theta / 2)}° cut off square</Txt>
    </Svg>
  );
};

/** Side profile of an offset (jog). */
const OffsetDiagram = ({ alpha, O, Lcc, up }: { alpha: number; O: number; Lcc: number; up: boolean }) => {
  const seg = 80, dx = seg * Math.cos(rad(alpha)), dy = seg * Math.sin(rad(alpha));
  const yLow = 104, yHigh = Math.max(24, yLow - dy);
  const [ya, yb] = up ? [yLow, yHigh] : [yHigh, yLow];
  const x1 = 90, x2 = x1 + dx;
  return (
    <Svg h={140}>
      <polyline points={`14,${ya} ${x1},${ya} ${x2},${yb} 286,${yb}`} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinejoin="round" />
      <line x1={x2 + 14} y1={yLow} x2={x2 + 14} y2={yHigh} stroke="currentColor" strokeWidth="1" />
      <Txt x={x2 + 20} y={(yLow + yHigh) / 2 + 4} anchor="start">Offset {fmt(O)}</Txt>
      <Txt x={(x1 + x2) / 2 - 22} y={(ya + yb) / 2 + 4} anchor="end">{fmt(Lcc)} mm</Txt>
      <Txt x={x1 + 6} y={ya + (up ? -6 : 14)} anchor="start" primary>{fmt(alpha)}°</Txt>
    </Svg>
  );
};

/** Top hat cross-section with its dimensions. */
const HatProfile = ({ C, D, F }: { C: number; D: number; F: number }) => (
  <Svg h={130}>
    <polyline points="30,100 80,100 80,40 220,40 220,100 270,100" fill="none" stroke="hsl(var(--primary))" strokeWidth="4" strokeLinejoin="round" />
    <Txt x={150} y={32}>Crown {fmt(C)}</Txt>
    <Txt x={72} y={74} anchor="end">Depth {fmt(D)}</Txt>
    <Txt x={55} y={118}>Flange {fmt(F)}</Txt>
    <Txt x={245} y={118}>Flange {fmt(F)}</Txt>
  </Svg>
);

/** Flat blank with the fold lines marked from the left edge. */
const BlankDiagram = ({ blank, marks }: { blank: number; marks: number[] }) => {
  const left = 14, width = 272;
  return (
    <Svg h={110}>
      <rect x={left} y={36} width={width} height={34} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {marks.map((m, i) => {
        const x = left + (m / blank) * width;
        return (
          <g key={i}>
            <line x1={x} y1={30} x2={x} y2={76} stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="4 2" />
            <Txt x={x} y={90} primary>{fmt(m)}</Txt>
          </g>
        );
      })}
      <Txt x={150} y={22}>Flat blank {fmt(blank)} mm — fold marks from left edge</Txt>
    </Svg>
  );
};

// ---------- Tool ----------

const CableTrayCutTool = ({ onBack }: Props) => {
  const [section, setSection] = useState<Section>("tray");
  const [trayBend, setTrayBend] = useState<TrayBend>("vert-in");
  const [hatBend, setHatBend] = useState<HatBend>("vert-in");
  const [angle, setAngle] = useState(90);
  const [cuts, setCuts] = useState("1");
  const [minRadius, setMinRadius] = useState("");
  const [offsetUp, setOffsetUp] = useState(true);
  const [offsetMm, setOffsetMm] = useState("");

  // tray
  const [trayW, setTrayW] = useState("");
  const [trayH, setTrayH] = useState("");
  // top hat
  const [hatC, setHatC] = useState("");
  const [hatD, setHatD] = useState("");
  const [hatF, setHatF] = useState("");
  const [hatT, setHatT] = useState("1");

  const [result, setResult] = useState<Result | null>(null);

  const bend = section === "tray" ? trayBend : hatBend;
  const isVertical = bend === "vert-in" || bend === "vert-out";
  const isOutside = bend === "vert-out";
  const needsAngle = !(section === "tophat" && hatBend === "flat");

  /** Vertical fold/bend maths — tray sides and top hat webs behave the same way. */
  const verticalBend = (H: number, partName: string, crossPart: string): Result | null => {
    const n = Math.max(1, Math.min(6, parseInt(cuts) || 1));
    const phi = angle / n;
    const w = 2 * H * Math.tan(rad(phi / 2));
    const R = parseFloat(minRadius) || 0;
    const s = n > 1 && R > 0 ? 2 * R * Math.tan(rad(phi / 2)) : 0;
    const warnings: string[] = [];
    if (n === 1 && R > 0) warnings.push("A single fold makes a sharp corner. Use 2+ cuts so the cable keeps its minimum bend radius (check the cable maker's figure).");
    if (n > 1 && R === 0) warnings.push("Enter the cable's minimum bend radius to get the cut spacing.");
    if (w > H * 2.01) warnings.push("Very wide notch — consider more cuts for a neater, stronger bend.");
    const steps = isOutside ? [
      `Mark the fold line${n > 1 ? "s" : ""} square across the ${partName === "side" ? "tray" : "top hat"}${n > 1 && s > 0 ? `, ${fmt(s)} mm apart` : ""}.`,
      `Cut straight through each ${partName}${crossPart ? ` and the ${crossPart}` : ""} on every fold line, top edge down to the base line.`,
      `Fold ${fmt(phi)}° at each cut. The cuts open about ${fmt(w)} mm at the top edge.`,
      "Bridge the gaps with a cover plate or splice so the run stays strong and continuous.",
    ] : [
      `Mark the fold line${n > 1 ? "s" : ""} square across the ${partName === "side" ? "tray" : "top hat"}${n > 1 && s > 0 ? `, ${fmt(s)} mm apart` : ""}.`,
      `On each ${partName}${crossPart ? ` and the ${crossPart}` : ""}, mark a V with its point on the base line and ${fmt(w)} mm across the top edge, centred on the fold line.`,
      "Cut the V-notches out (grinder or snips), then deburr.",
      `Fold until each notch closes (${fmt(phi)}° per cut, ${fmt(angle)}° total). Fix the closed notches with a bracket or rivets.`,
    ];
    steps.push("Treat cut edges (deburr, cold-gal paint) and confirm the run is mechanically fixed and electrically continuous.");
    return {
      headline: { value: fmt(w), unit: " mm", label: `${isOutside ? "Gap opening" : "Notch width"} at top edge, per cut` },
      rows: [
        { label: "Cuts", value: String(n) },
        { label: "Angle per cut", value: fmt(phi), unit: "°" },
        { label: `${partName === "side" ? "Side" : "Web"} height`, value: fmt(H), unit: "mm" },
        ...(s > 0 ? [{ label: "Cut spacing", value: fmt(s), unit: "mm" }] : []),
      ],
      steps,
      warnings,
      diagram: <NotchDiagram H={H} w={w} n={n} s={s} outside={isOutside} />,
    };
  };

  const mitreBend = (Wide: number): Result => {
    const L = Wide * Math.tan(rad(angle / 2));
    return {
      headline: { value: fmt(L), unit: " mm", label: "Long point to short point, along the tray" },
      rows: [
        { label: "Cut angle off square", value: fmt(angle / 2), unit: "°" },
        { label: "Overall width", value: fmt(Wide), unit: "mm" },
        { label: "Pieces", value: "2 (same cut each)" },
      ],
      steps: [
        `Mark a square line across the end of the length, then measure ${fmt(L)} mm along one edge.`,
        "Join that mark to the opposite corner. That's your cut line.",
        "Cut both pieces to the same line. Flip one over so the cuts mate.",
        `Join with splice plates. Two ${fmt(angle / 2)}° cuts make a ${fmt(angle)}° turn.`,
        "Bond / fix across the joint and treat cut edges.",
      ],
      warnings: angle > 90 ? ["Mitre angles over 90° aren't practical — use a factory fitting."] : [],
      diagram: <MitreDiagram W={Wide} L={L} theta={angle} />,
    };
  };

  const calculate = () => {
    if (section === "tray") {
      const W = parseFloat(trayW), H = parseFloat(trayH);
      if (trayBend === "mitre") {
        if (!(W > 0)) return;
        setResult(mitreBend(W));
        return;
      }
      if (!(H > 0)) return;
      if (trayBend === "offset") {
        const O = parseFloat(offsetMm);
        if (!(O > 0) || angle >= 90) return;
        const a = rad(angle);
        const Lcc = O / Math.sin(a);
        const run = O / Math.tan(a);
        const w = 2 * H * Math.tan(a / 2);
        const [first, second] = offsetUp ? ["inside bend (V-notch)", "outside bend (slit)"] : ["outside bend (slit)", "inside bend (V-notch)"];
        setResult({
          headline: { value: fmt(Lcc), unit: " mm", label: "Distance between the two bends" },
          rows: [
            { label: "Multiplier", value: String(Math.round(100 / Math.sin(a)) / 100), unit: "× offset" },
            { label: "Run covered", value: fmt(run), unit: "mm" },
            { label: "Shrink (length lost)", value: fmt(Lcc - run), unit: "mm" },
            { label: "Notch / gap width", value: fmt(w), unit: "mm" },
          ],
          steps: [
            `Mark bend 1 and bend 2 square across the tray, ${fmt(Lcc)} mm apart.`,
            `Bend 1 — ${first}: ${fmt(w)} mm at the top edge of each side.`,
            `Bend 2 — ${second}: ${fmt(w)} mm at the top edge of each side.`,
            `Fold both bends ${fmt(angle)}° (opposite directions) so the tray rises ${fmt(O)} mm.`,
            `Allow ${fmt(Lcc - run)} mm for the shrink when you measure the next length.`,
          ],
          warnings: angle > 45 ? ["Steep jog — cables may not sit well. Check the cable's minimum bend radius."] : [],
          diagram: <OffsetDiagram alpha={angle} O={O} Lcc={Lcc} up={offsetUp} />,
        });
        return;
      }
      setResult(verticalBend(H, "side", ""));
      return;
    }

    // top hat
    if (hatBend === "flat") {
      const C = parseFloat(hatC), D = parseFloat(hatD), F = parseFloat(hatF), t = parseFloat(hatT);
      if (!(C > 0 && D > 0 && F > 0 && t > 0)) return;
      const r = t; // inside radius ≈ thickness for a standard brake bend
      const K = 0.4;
      const BA = (Math.PI / 2) * (r + K * t);
      const OSSB = r + t;
      const BD = 2 * OSSB - BA;
      const blank = 2 * F + 2 * D + C - 4 * BD;
      const m1 = F - OSSB + BA / 2;
      const m2 = m1 + D - 2 * OSSB + BA;
      const m3 = m2 + C - 2 * OSSB + BA;
      const m4 = m3 + D - 2 * OSSB + BA;
      const warnings: string[] = [];
      if (t > 3) warnings.push("Thick material — use your press brake's bend chart instead of this estimate.");
      if (F < 4 * t) warnings.push("Flange is short for the thickness — it may not hold in the brake.");
      setResult({
        headline: { value: fmt(blank), unit: " mm", label: "Flat blank width to cut" },
        rows: [
          { label: "Fold 1 (from edge)", value: fmt(m1), unit: "mm" },
          { label: "Fold 2", value: fmt(m2), unit: "mm" },
          { label: "Fold 3", value: fmt(m3), unit: "mm" },
          { label: "Fold 4", value: fmt(m4), unit: "mm" },
          { label: "Deduction per fold", value: fmt(BD), unit: "mm" },
        ],
        steps: [
          `Cut a strip ${fmt(blank)} mm wide.`,
          `Mark fold lines at ${fmt(m1)}, ${fmt(m2)}, ${fmt(m3)} and ${fmt(m4)} mm from one edge.`,
          "Fold 1 and 4 (flanges) one way, 2 and 3 (crown) the opposite way, all 90°.",
          "Fold a test piece first and adjust the marks if it comes out over or under size.",
        ],
        warnings,
        diagram: <BlankDiagram blank={blank} marks={[m1, m2, m3, m4]} />,
      });
      return;
    }
    const C = parseFloat(hatC), D = parseFloat(hatD), F = parseFloat(hatF);
    if (hatBend === "mitre") {
      if (!(C > 0 && F > 0)) return;
      setResult(mitreBend(C + 2 * F));
      return;
    }
    if (!(D > 0)) return;
    setResult(verticalBend(D, "web", "crown"));
  };

  const pick = <T extends string>(set: (v: T) => void, v: T) => { set(v); setResult(null); };

  const num = (label: string, value: string, set: (v: string) => void, placeholder: string, hint?: string) => (
    <div>
      <Label className="text-sm">{label}</Label>
      <Input type="number" inputMode="decimal" className="h-11 mt-1" placeholder={placeholder}
        value={value} onChange={(e) => set(e.target.value)} />
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );

  return (
    <ToolLayout
      title="Cable Tray & Top Hat Cut Helper"
      subtitle="Where to cut and fold — tray bends and metal top hat"
      disclaimer="Fabrication guide only. Tray figures are geometric (material thickness ignored). Top hat flat pattern assumes mild steel, inside radius = thickness, K-factor 0.4 — fold a test piece. Confirm the cable's minimum bend radius with the cable manufacturer and follow the tray manufacturer's bending instructions."
      onBack={onBack}
      onCalculate={calculate}
      result={result ? (
        <>
          <div className="p-3 rounded-lg mb-3 border bg-primary/5 border-primary/20">
            <p className="text-3xl font-extrabold text-primary">{result.headline.value}<span className="text-base font-bold">{result.headline.unit}</span></p>
            <p className="text-xs text-muted-foreground mt-1">{result.headline.label}</p>
          </div>
          <div className="rounded-lg border bg-background p-2 mb-3">{result.diagram}</div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            {result.rows.map((r) => (
              <ResultRow key={r.label} label={r.label} value={r.value} unit={r.unit} size="sm" />
            ))}
          </div>
          <p className="text-xs font-bold mb-1">How to mark it out</p>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-foreground">
            {result.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive mt-2 font-medium">⚠️ {w}</p>
          ))}
        </>
      ) : undefined}
    >
      <div>
        <Label className="text-sm">Material</Label>
        <div className="flex gap-2 mt-1">
          {([["tray", "Cable tray"], ["tophat", "Metal top hat"]] as const).map(([k, l]) => (
            <Badge key={k} variant={section === k ? "default" : "outline"} className="cursor-pointer px-3 py-1.5 text-sm"
              onClick={() => pick<Section>(setSection, k)}>{l}</Badge>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm">What are you making?</Label>
        <Select
          value={bend}
          onValueChange={(v) => {
            if (section === "tray") setTrayBend(v as TrayBend);
            else setHatBend(v as HatBend);
            setResult(null);
          }}
        >
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="vert-in">Vertical inside bend (V-notch)</SelectItem>
            <SelectItem value="vert-out">Vertical outside bend (slit)</SelectItem>
            <SelectItem value="mitre">Horizontal turn (mitre)</SelectItem>
            {section === "tray" && <SelectItem value="offset">Offset / jog</SelectItem>}
            {section === "tophat" && <SelectItem value="flat">Fold a top hat from flat sheet</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {needsAngle && (
        <div>
          <Label className="text-sm">{bend === "offset" ? "Bend angle" : "Total angle"}</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {ANGLES.filter((a) => bend !== "offset" || a < 90).map((a) => (
              <Badge key={a} variant={angle === a ? "default" : "outline"} className="cursor-pointer px-3 py-1.5 text-sm"
                onClick={() => { setAngle(a); setResult(null); }}>{a}°</Badge>
            ))}
          </div>
        </div>
      )}

      {section === "tray" && (
        <>
          {trayBend === "mitre"
            ? num("Tray width (mm)", trayW, setTrayW, "e.g. 300", "Overall width, outside to outside")
            : num("Side height (mm)", trayH, setTrayH, "e.g. 50", "Height of the tray side")}
          {trayBend === "offset" && (
            <>
              {num("Offset height (mm)", offsetMm, setOffsetMm, "e.g. 150", "How far the tray has to move over or up")}
              <div>
                <Label className="text-sm">Direction</Label>
                <div className="flex gap-2 mt-1">
                  {([[true, "Up"], [false, "Down"]] as const).map(([k, l]) => (
                    <Badge key={l} variant={offsetUp === k ? "default" : "outline"} className="cursor-pointer px-3 py-1.5 text-sm"
                      onClick={() => { setOffsetUp(k); setResult(null); }}>{l}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {section === "tophat" && (
        <>
          {(hatBend === "flat" || hatBend === "mitre") && num("Crown width (mm)", hatC, setHatC, "e.g. 35", "Outside, across the top of the hat")}
          {hatBend !== "mitre" && num("Depth (mm)", hatD, setHatD, "e.g. 16", "Overall height, top of crown to underside of flange")}
          {(hatBend === "flat" || hatBend === "mitre") && num("Flange width each side (mm)", hatF, setHatF, "e.g. 20", "From the outside of the web to the flange edge")}
          {hatBend === "flat" && num("Material thickness (mm)", hatT, setHatT, "e.g. 1")}
          {hatBend !== "mitre" && hatBend !== "flat" && (
            <div className="rounded-lg border p-2"><HatProfile C={parseFloat(hatC) || 35} D={parseFloat(hatD) || 16} F={parseFloat(hatF) || 20} /></div>
          )}
        </>
      )}

      {isVertical && (
        <>
          <div>
            <Label className="text-sm">Number of cuts</Label>
            <div className="flex gap-2 mt-1">
              {["1", "2", "3", "4"].map((k) => (
                <Badge key={k} variant={cuts === k ? "default" : "outline"} className="cursor-pointer px-3 py-1.5 text-sm"
                  onClick={() => { setCuts(k); setResult(null); }}>{k}</Badge>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">More cuts = smoother sweep, smaller notches</p>
          </div>
          {num("Cable minimum bend radius (mm) — optional", minRadius, setMinRadius, "e.g. 300", "From the cable datasheet — gives the cut spacing")}
        </>
      )}
    </ToolLayout>
  );
};

export default CableTrayCutTool;
