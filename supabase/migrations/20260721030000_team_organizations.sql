-- Team/organisation accounts with per-seat billing.
--
-- One company holds the licence, uploads each standard once, and its
-- employees share read/write access as members of that one org — a
-- fundamentally different (and legal) pattern from copying processed
-- content between unrelated individual accounts, which was ruled out
-- earlier as a copyright/licensing risk.
--
-- Membership is a simple email allowlist (no invite tokens/emails): the
-- owner adds a teammate's email, and the moment a profile with that email
-- exists, they're auto-linked as an active member (via handle_new_user for
-- brand-new signups, or link_pending_org_membership() for existing users
-- added to a team after the fact).
--
-- seat_limit is written ONLY by the stripe-webhook function (service role),
-- mirroring the existing subscription_tier write pattern, so it always
-- reflects what's actually been paid for — the seat cap is enforced in the
-- database regardless of insert path, closing the "hundreds of people on
-- one licence" abuse case with real billing rather than trust.

-- Stripe subscriptions can now carry a seat quantity (>1 for team plans).
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  seat_limit INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ,
  UNIQUE (organization_id, invited_email)
);

CREATE INDEX idx_org_members_org ON public.organization_members (organization_id);
CREATE INDEX idx_org_members_user ON public.organization_members (user_id);

-- Shared-library columns. Denormalized (not joined through `standards`) to
-- match how these tables already carry their own user_id rather than
-- joining back — keeps RLS and the hot chat-retrieval path index-only.
ALTER TABLE public.standards ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE public.standard_chunks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE public.standard_figures ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE public.standard_tables ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX idx_standards_org ON public.standards (organization_id);
CREATE INDEX idx_standard_chunks_org ON public.standard_chunks (organization_id);

-- ── Seat cap: enforced at the database layer, any insert path ──────────────
CREATE OR REPLACE FUNCTION public.enforce_org_seat_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat_limit INT;
  v_current_count INT;
BEGIN
  SELECT seat_limit INTO v_seat_limit FROM public.organizations WHERE id = NEW.organization_id;
  SELECT count(*) INTO v_current_count FROM public.organization_members WHERE organization_id = NEW.organization_id;

  IF v_seat_limit IS NULL OR v_current_count >= v_seat_limit THEN
    RAISE EXCEPTION 'Team seat limit reached (% of % seats used) — add a seat before adding another member', v_current_count, COALESCE(v_seat_limit, 0);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_org_seat_cap
  BEFORE INSERT ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_seat_cap();

-- ── RLS: organizations / organization_members ───────────────────────────────
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Readable by the owner and by active members. No client INSERT/UPDATE/DELETE
-- policy exists on `organizations` — seat_limit is webhook-only (service role
-- bypasses RLS), same pattern as `subscriptions` already uses.
CREATE POLICY "Org visible to owner and members" ON public.organizations FOR SELECT USING (
  auth.uid() = owner_user_id
  OR auth.uid() IN (SELECT user_id FROM public.organization_members WHERE organization_id = organizations.id AND status = 'active')
);

-- Readable by the owner and by fellow active members (so a member can see
-- their teammates). All writes go through the SECURITY DEFINER RPCs below —
-- no client INSERT/UPDATE/DELETE policy exists.
CREATE POLICY "Org members visible to owner and teammates" ON public.organization_members FOR SELECT USING (
  auth.uid() IN (SELECT owner_user_id FROM public.organizations WHERE id = organization_members.organization_id)
  OR auth.uid() IN (
    SELECT om2.user_id FROM public.organization_members om2
    WHERE om2.organization_id = organization_members.organization_id AND om2.status = 'active'
  )
);

-- ── RLS: extend the standards-library tables to include org-shared access ──
DROP POLICY IF EXISTS "Users can view own standards" ON public.standards;
CREATE POLICY "Users can view own standards" ON public.standards FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND status = 'active'
  ))
);

DROP POLICY IF EXISTS "Users can delete own standards" ON public.standards;
CREATE POLICY "Users can delete own standards" ON public.standards FOR DELETE USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND organization_id IN (
    SELECT organization_id FROM public.organizations WHERE id = standards.organization_id AND owner_user_id = auth.uid()
  ))
);

DROP POLICY IF EXISTS "Users can view own chunks" ON public.standard_chunks;
CREATE POLICY "Users can view own chunks" ON public.standard_chunks FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND status = 'active'
  ))
);

DROP POLICY IF EXISTS "Users can view their own figures" ON public.standard_figures;
CREATE POLICY "Users can view their own figures" ON public.standard_figures FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND status = 'active'
  ))
);

DROP POLICY IF EXISTS "Users can view their own tables" ON public.standard_tables;
CREATE POLICY "Users can view their own tables" ON public.standard_tables FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND status = 'active'
  ))
);
-- INSERT policies on all four tables stay `auth.uid() = user_id` unchanged —
-- a member always inserts as themselves; organization_id is set by the
-- upload path, never claimed by the client. citations/queries are untouched:
-- chat/question history stays private per person.

-- ── Auto-link: brand-new signup whose email was already added to a team ────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);

  UPDATE public.organization_members
  SET user_id = NEW.id, status = 'active', joined_at = now()
  WHERE lower(invited_email) = lower(NEW.email) AND status = 'pending';

  RETURN NEW;
END;
$$;

-- ── Auto-link: existing user whose email gets added to a team afterwards ───
CREATE OR REPLACE FUNCTION public.link_pending_org_membership()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email TEXT;
BEGIN
  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.organization_members
  SET user_id = auth.uid(), status = 'active', joined_at = now()
  WHERE lower(invited_email) = lower(caller_email) AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_pending_org_membership() TO authenticated;

-- ── Owner-only team management RPCs ─────────────────────────────────────────
-- Adds a member by email. If that email already has an account, links them
-- as active immediately; otherwise inserts a pending row that auto-activates
-- on signup (handle_new_user) or next session (link_pending_org_membership).
-- The seat cap trigger enforces the limit regardless of this RPC's logic.
CREATE OR REPLACE FUNCTION public.add_org_member(p_organization_id UUID, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
  v_existing_user_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id AND owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the team owner can add members';
  END IF;

  SELECT id INTO v_existing_user_id FROM auth.users WHERE lower(email) = lower(p_email);

  INSERT INTO public.organization_members (organization_id, invited_email, user_id, status, joined_at)
  VALUES (
    p_organization_id,
    lower(p_email),
    v_existing_user_id,
    CASE WHEN v_existing_user_id IS NOT NULL THEN 'active' ELSE 'pending' END,
    CASE WHEN v_existing_user_id IS NOT NULL THEN now() ELSE NULL END
  )
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_org_member(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_org_member(p_member_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.organization_members WHERE id = p_member_id;
  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = v_org_id AND owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the team owner can remove members';
  END IF;

  DELETE FROM public.organization_members WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_org_member(UUID) TO authenticated;
