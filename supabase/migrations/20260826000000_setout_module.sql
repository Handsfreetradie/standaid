-- Rough-In Setout Assistant — electrical-only add-on module. Full data model
-- (plans, circuits, fittings) is built now even though the first UI pass only
-- uses a subset of it, per the module's build plan.

-- Paid add-on entitlement gating the Rough-In Setout Assistant module.
-- Separate from trade_type — a sparky can be trade_type = 'electrical'
-- without having purchased this add-on.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_setout_addon BOOLEAN NOT NULL DEFAULT false;

-- Create setout_plans table
CREATE TABLE public.setout_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  job_reference TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('import', 'draw')),
  scale_calibration JSONB,
  walls JSONB NOT NULL DEFAULT '[]'::jsonb,
  layer_visibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create setout_circuits table
CREATE TABLE public.setout_circuits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.setout_plans(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  breaker_rating TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create setout_fittings table
CREATE TABLE public.setout_fittings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.setout_plans(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  position JSONB NOT NULL,
  category TEXT NOT NULL,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  measurement_lock JSONB,
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'confirmed')),
  circuit_id UUID REFERENCES public.setout_circuits(id) ON DELETE SET NULL,
  linked_to UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_setout_plans_user ON public.setout_plans (user_id);
CREATE INDEX idx_setout_circuits_plan ON public.setout_circuits (plan_id);
CREATE INDEX idx_setout_fittings_plan ON public.setout_fittings (plan_id);
CREATE INDEX idx_setout_fittings_circuit ON public.setout_fittings (circuit_id);

-- Enable RLS
ALTER TABLE public.setout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setout_circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setout_fittings ENABLE ROW LEVEL SECURITY;

-- Setout plans policies (direct ownership)
CREATE POLICY "Users can view own setout plans" ON public.setout_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own setout plans" ON public.setout_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own setout plans" ON public.setout_plans FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own setout plans" ON public.setout_plans FOR DELETE USING (auth.uid() = user_id);

-- Setout circuits policies (ownership via setout_plans)
CREATE POLICY "Users can view own setout circuits" ON public.setout_circuits FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own setout circuits" ON public.setout_circuits FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own setout circuits" ON public.setout_circuits FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own setout circuits" ON public.setout_circuits FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);

-- Setout fittings policies (ownership via setout_plans)
CREATE POLICY "Users can view own setout fittings" ON public.setout_fittings FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own setout fittings" ON public.setout_fittings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own setout fittings" ON public.setout_fittings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own setout fittings" ON public.setout_fittings FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);

-- updated_at triggers — reuses public.update_updated_at_column(), already
-- defined in 20260310055436_4cab835f-325a-45c3-9afd-5ccbf8c8a798.sql.
CREATE TRIGGER update_setout_plans_updated_at BEFORE UPDATE ON public.setout_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_setout_fittings_updated_at BEFORE UPDATE ON public.setout_fittings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
