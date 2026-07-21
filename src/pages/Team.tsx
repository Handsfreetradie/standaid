import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, ArrowLeft, Loader2, Mail, Trash2, Crown, Clock, CheckCircle2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useOrganization, useOrganizationMembers } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const Team = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: org, isLoading: orgLoading } = useOrganization();
  const { data: members = [], isLoading: membersLoading } = useOrganizationMembers(org?.id);

  const [teamName, setTeamName] = useState("");
  const [seatCount, setSeatCount] = useState("3");
  const [creating, setCreating] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const isOwner = org?.role === "owner";
  const seatsUsed = members.length;
  const atCapacity = !!org && seatsUsed >= org.seat_limit;

  const startTeamCheckout = async () => {
    if (!teamName.trim()) {
      toast.error("Give your team a name first.");
      return;
    }
    const seats = Number(seatCount);
    if (!Number.isInteger(seats) || seats < 1 || seats > 500) {
      toast.error("Seat count must be a whole number between 1 and 500.");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { tier: "business_team", initial_seats: seats, team_name: teamName.trim() },
      });
      if (error || !data?.url) throw error ?? new Error("No checkout URL");
      window.location.href = data.url;
    } catch (e) {
      console.error("[team checkout] error:", e);
      toast.error("Couldn't start checkout — please try again.");
      setCreating(false);
    }
  };

  const addMember = async () => {
    if (!org) return;
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    setAddingMember(true);
    try {
      if (atCapacity) {
        const { error: seatError } = await supabase.functions.invoke("add-team-seat", {
          body: { organization_id: org.id },
        });
        if (seatError) throw seatError;
      }
      const { error } = await supabase.rpc("add_org_member", {
        p_organization_id: org.id,
        p_email: email,
      });
      if (error) throw error;
      toast.success(`${email} added to the team.`);
      setNewEmail("");
      queryClient.invalidateQueries({ queryKey: ["organization-members", org.id] });
    } catch (e: any) {
      console.error("[add member] error:", e);
      toast.error(e?.message || "Couldn't add that teammate — please try again.");
    } finally {
      setAddingMember(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!org) return;
    try {
      const { error } = await supabase.rpc("remove_org_member", { p_member_id: memberId });
      if (error) throw error;
      toast.success("Removed from the team.");
      queryClient.invalidateQueries({ queryKey: ["organization-members", org.id] });
    } catch (e: any) {
      console.error("[remove member] error:", e);
      toast.error(e?.message || "Couldn't remove that teammate.");
    } finally {
      setPendingRemoveId(null);
    }
  };

  if (orgLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-lg mx-auto">
      <button
        onClick={() => navigate("/profile")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Profile
      </button>

      {!org ? (
        <>
          <h1 className="font-sans text-xl font-extrabold text-foreground mb-2">Set up a team</h1>
          <p className="text-sm text-muted-foreground mb-6">
            One licence, shared with your whole crew. Upload a standard once and every teammate can search it —
            you pay per seat, and can add more people any time.
          </p>

          <Card className="p-4 space-y-4">
            <div>
              <Label className="text-sm">Team name</Label>
              <Input
                className="h-11 mt-1"
                placeholder="e.g. Acme Electrical"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm">How many people, including you?</Label>
              <Input
                className="h-11 mt-1"
                type="number"
                min={1}
                max={500}
                value={seatCount}
                onChange={(e) => setSeatCount(e.target.value)}
              />
            </div>
            <Button className="w-full h-11 font-semibold gap-1.5" disabled={creating} onClick={startTeamCheckout}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Continue to payment
            </Button>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="font-sans text-xl font-extrabold text-foreground">{org.name}</h1>
              <p className="text-sm text-muted-foreground">
                {seatsUsed} / {org.seat_limit} seats used
              </p>
            </div>
          </div>

          {isOwner && (
            <Card className="p-4 mb-4 space-y-3">
              <Label className="text-sm">Add a teammate</Label>
              <div className="flex gap-2">
                <Input
                  className="h-11"
                  type="email"
                  placeholder="teammate@company.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <Button className="h-11 gap-1.5 flex-shrink-0" disabled={addingMember} onClick={addMember}>
                  {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add
                </Button>
              </div>
              {atCapacity && (
                <p className="text-xs text-muted-foreground">
                  You're at capacity — adding one more will buy an extra seat (prorated charge).
                </p>
              )}
            </Card>
          )}

          <Card className="p-2 divide-y divide-border">
            {membersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {m.role === "owner"
                      ? <Crown className="h-4 w-4 text-primary flex-shrink-0" />
                      : <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                    <span className="text-sm font-medium text-foreground truncate">{m.invited_email}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={m.status === "active" ? "secondary" : "outline"} className="text-xs gap-1">
                      {m.status === "active"
                        ? <><CheckCircle2 className="h-3 w-3" /> Active</>
                        : <><Clock className="h-3 w-3" /> Pending</>}
                    </Badge>
                    {isOwner && m.role !== "owner" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingRemoveId(m.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      )}

      <AlertDialog open={!!pendingRemoveId} onOpenChange={(open) => { if (!open) setPendingRemoveId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this teammate?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll immediately lose access to the shared standards library. This doesn't reduce your paid
              seat count — you can add someone else in their place any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingRemoveId && removeMember(pendingRemoveId)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Team;
