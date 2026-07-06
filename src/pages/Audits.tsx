import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Plus, ChevronRight, Loader2, Lock, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";

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
  const { data: profile } = useProfile();
  const tier = profile?.subscription_tier || "free";
  const isPro = tier === "pro" || tier === "business";

  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!user || !isPro) { setLoading(false); return; }
    sb.from("audits").select("id, title, site_address, status, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }: any) => { setAudits(data || []); setLoading(false); });
  }, [user, isPro]);

  const createAudit = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const { data, error } = await sb.from("audits")
        .insert({ user_id: user!.id, title: title.trim(), site_address: address.trim() || null })
        .select().single();
      if (error) throw error;
      navigate(`/audits/${data.id}`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't create the audit — please try again.");
      setCreating(false);
    }
  };

  if (!isPro) {
    return (
      <div className="h-full overflow-y-auto px-5 py-8">
        <div className="max-w-md mx-auto text-center mt-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Site Audit is a Pro feature</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Walk a job, photograph each item, and get an AI compliance assessment against your standards — with the questions it needs answered.
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
            <Button className="w-full gap-1.5" onClick={createAudit} disabled={creating || !title.trim()}>
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
