-- Maximum Demand calc (AS/NZS 3000:2018 Appendix C) needs loads that aren't
-- drawn as canvas symbols — hot water, oven, hotplate, ducted aircon, EV
-- charger, etc. — to still count toward the total. This table is that
-- manual load list, plan-scoped exactly like setout_circuits.

CREATE TABLE public.setout_load_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.setout_plans(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  -- AS3000 Table C1 load-group key (see LOAD_GROUPS in setoutMaximumDemand.ts)
  load_group TEXT NOT NULL,
  rating_w NUMERIC NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  circuit_id UUID REFERENCES public.setout_circuits(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_setout_load_items_plan ON public.setout_load_items (plan_id);
CREATE INDEX idx_setout_load_items_circuit ON public.setout_load_items (circuit_id);

ALTER TABLE public.setout_load_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own setout load items" ON public.setout_load_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own setout load items" ON public.setout_load_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own setout load items" ON public.setout_load_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own setout load items" ON public.setout_load_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
