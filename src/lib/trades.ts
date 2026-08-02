// Canonical trade list for the Site Audit feature — mirrors the trade ids
// used by onboarding/home (Index.tsx, OnboardingIndustry.tsx) so a user's
// saved trade_type lines up, without importing from those unrelated pages.

export const TRADES = [
  { id: "electrical", icon: "⚡", name: "Electrical" },
  { id: "plumbing", icon: "🔧", name: "Plumbing" },
  { id: "building", icon: "🏗️", name: "Building & Construction" },
  { id: "carpentry", icon: "🔩", name: "Carpentry" },
  { id: "gas", icon: "🔥", name: "Gas Fitting" },
  { id: "hvac", icon: "🌡️", name: "HVAC" },
  { id: "health_safety", icon: "⚕️", name: "Health & Safety" },
  { id: "engineering", icon: "🏭", name: "Engineering" },
  { id: "food_safety", icon: "🍽️", name: "Food Safety" },
  { id: "other", icon: "📐", name: "Other" },
];

// Noun used in the AI audit prompt, e.g. "a licensed Australian electrician".
export const TRADE_PERSONA: Record<string, string> = {
  electrical: "electrician",
  plumbing: "plumber",
  building: "builder",
  carpentry: "carpenter",
  gas: "gas fitter",
  hvac: "HVAC technician",
  health_safety: "health & safety officer",
  engineering: "engineer",
  food_safety: "food safety auditor",
  other: "tradesperson",
};
