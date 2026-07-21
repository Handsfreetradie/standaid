-- Fix infinite recursion in team RLS policies.
--
-- organization_members' own SELECT policy queried organization_members from
-- within its own USING clause (to check "is this caller a teammate in the
-- same org"), which re-triggers the same policy evaluation forever. Because
-- standards/standard_chunks/standard_figures/standard_tables and
-- organizations all query organization_members to check org membership, the
-- recursion broke queries against ALL of those tables for every user, not
-- just team members — a real user's own standards became invisible.
--
-- Fix: move the membership check into a SECURITY DEFINER function. Called
-- from inside a policy, it runs with the function owner's privileges (which
-- bypasses RLS as the table owner), so it queries organization_members
-- without re-entering its RLS policy — breaking the cycle.

CREATE OR REPLACE FUNCTION public.is_active_org_member(check_org_id UUID, check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = check_org_id AND user_id = check_user_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(check_org_id UUID, check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations
    WHERE id = check_org_id AND owner_user_id = check_user_id
  );
$$;

-- organizations: was fine on its own, but rewritten to use the helper for
-- consistency and so it never triggers organization_members' policy directly.
DROP POLICY IF EXISTS "Org visible to owner and members" ON public.organizations;
CREATE POLICY "Org visible to owner and members" ON public.organizations FOR SELECT USING (
  auth.uid() = owner_user_id
  OR public.is_active_org_member(id, auth.uid())
);

-- organization_members: the actual source of the recursion — no longer
-- queries organization_members from within its own policy.
DROP POLICY IF EXISTS "Org members visible to owner and teammates" ON public.organization_members;
CREATE POLICY "Org members visible to owner and teammates" ON public.organization_members FOR SELECT USING (
  public.is_org_owner(organization_id, auth.uid())
  OR public.is_active_org_member(organization_id, auth.uid())
);

-- standards / standard_chunks / standard_figures / standard_tables: replace
-- the raw organization_members subquery with the helper function.
DROP POLICY IF EXISTS "Users can view own standards" ON public.standards;
CREATE POLICY "Users can view own standards" ON public.standards FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can delete own standards" ON public.standards;
CREATE POLICY "Users can delete own standards" ON public.standards FOR DELETE USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND public.is_org_owner(organization_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can view own chunks" ON public.standard_chunks;
CREATE POLICY "Users can view own chunks" ON public.standard_chunks FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can view their own figures" ON public.standard_figures;
CREATE POLICY "Users can view their own figures" ON public.standard_figures FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can view their own tables" ON public.standard_tables;
CREATE POLICY "Users can view their own tables" ON public.standard_tables FOR SELECT USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND public.is_active_org_member(organization_id, auth.uid()))
);
