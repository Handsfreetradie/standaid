import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Plus, ChevronRight, Loader2, Lock, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { TRADES } from "@/lib/trades";

const sb = supabase as any; // audits tables aren't in the generated types yet

interface AuditRow {
  id: string;
  title: string;
  site_address: string | null;
  status: string;
  created_at: string;
}

const Audits = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  // No fallback guess — while the profile is still loading, `tier` is
  // undefined so isPro is false. The render below waits on profileLoading
  // before showing the "upgrade" paywall, so a slow fetch can't momentarily
  // lock out a Pro/Business tradie who's actually entitled to this page.
  const tier = profile?.subscription_tier;
  const isPro = tier === "pro" || tier === "business";

  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [showNew, setShowNew] = useState(false);

  const profileTrades = profile?.trade_type ? profile.trade_type.split(",").filter(Boolean) : [];
  const tradeOptions = profileTrades.length > 0 ? TRADES.filter((t) => profileTrades.includes(t.id)) : TRADES;
  const [trade, setTrade] = useState<string>("");
  const needsTradePicker = profileTrades.length !== 1;
  const effectiveTrade = needsTradePicker ? trade : profileTrades[0];

  useEffect(() => {
    if (!user || !isPro) { setLoading(false); return; }
    sb.from("audits").select("id, title, site_address, status, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }: any) => { setAudits(data || []); setLoading(false); });
  }, [user, isPro]);

  const createAudit = async () => {
    if (!title.trim() || creating || !effectiveTrade) return;
    setCreating(true);
    try {
      const { data, error } = await sb.from("audits")
        .insert({ user_id: user!.id, title: title.trim(), site_address: address.trim() || null, trade: effectiveTrade })
        .select().single();
      if (error) throw error;
      navigate(`/audits/${data.id}`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't create the audit — please try again.");
      setCreating(false);
    }
  };

  const deleteAudit = async (id: string) => {
    if (!window.confirm("Delete this audit? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      // Collect storage paths BEFORE deleting the row — audit_photos cascade-
      // deletes with the audit and the paths become unrecoverable after that.
      const { data: photoRows } = await sb.from("audit_photos").select("storage_path").eq("audit_id", id);

      const { error } = await sb.from("audits").delete().eq("id", id);
      if (error) throw error;

      try {
        const paths = (photoRows || []).map((p: any) => p.storage_path).filter(Boolean);
        if (paths.length > 0) await supabase.storage.from("audit-photos").remove(paths);
      } catch (e) {
        console.warn("Storage cleanup after audit delete failed (non-fatal):", e);
      }

      setAudits((prev) => prev.filter((a) => a.id !== id));
      toast.success("Audit deleted");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't delete the audit — please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  if (profileLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!isPro) {
    return (
      <div className="h-full overflow-y-auto px-5 py-8">
        <div className="max-w-md mx-auto text-center mt-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Site Audit is a Pro feature</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Walk a job, photograph each item, and run your own compliance audit against your documents — AI helps flag issues and asks the questions it needs answered.
          </p>
          <Button onClick={() => navigate("/profile")} className="gap-1.5">Upgrade to Pro</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-extrabold text-foreground">Site Audits</h1>
          <Button size="sm" onClick={() => setShowNew((v) => !v)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          AI-assisted reference — not a certified inspection. Always verify and sign off on site.
        </p>

        {showNew && (
          <Card className="p-4 mb-5 space-y-3">
            <Input placeholder="Audit name (e.g. 12 Smith St — board upgrade)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Site address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
            {needsTradePicker && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-1.5">Trade for this audit</p>
                <div className="flex flex-wrap gap-1.5">
                  {tradeOptions.map((t) => (
                    <Badge key={t.id} variant={trade === t.id ? "default" : "outline"}
                      className="cursor-pointer text-[11px] px-2 py-1" onClick={() => setTrade(t.id)}>
                      {t.icon} {t.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <Button className="w-full gap-1.5" onClick={createAudit} disabled={creating || !title.trim() || !effectiveTrade}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              Start audit
            </Button>
          </Card>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : audits.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            No audits yet. Tap <span className="font-semibold text-foreground">New</span> to start one.
          </div>
        ) : (
          <div className="space-y-2">
            {audits.map((a) => (
              <Card key={a.id} className="p-3 flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors"
                onClick={() => navigate(`/audits/${a.id}`)}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{a.title}</p>
                  {a.site_address && (
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {a.site_address}
                    </p>
                  )}
                </div>
                <Button
                  size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); deleteAudit(a.id); }}
                  disabled={deletingId === a.id}
                >
                  {deletingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Audits;
