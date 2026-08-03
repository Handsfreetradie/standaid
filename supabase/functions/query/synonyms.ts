/**
 * Tradie-to-standards terminology map.
 * Keys are lowercase tradie phrases, values are the standard terms they map to.
 * Longer phrases are matched first to avoid partial matches.
 */
export const TRADIE_SYNONYMS: Record<string, string[]> = {
  // ── Electrical: outlets ──────────────────────────────────────────────────────
  "double power point":       ["socket-outlet", "duplex socket-outlet", "twin gpo"],
  "single power point":       ["socket-outlet", "single gpo"],
  "power point":              ["socket-outlet", "socket outlet", "gpo", "general purpose outlet"],
  "powerpoint":               ["socket-outlet", "socket outlet", "gpo"],
  "power outlet":             ["socket-outlet", "socket outlet"],
  "power socket":             ["socket-outlet"],
  "gpo":                      ["socket-outlet", "general purpose outlet"],
  "double gpo":               ["socket-outlet", "duplex socket-outlet"],
  "usb power point":          ["socket-outlet", "combination socket-outlet"],
  "surge protector":          ["surge protective device", "spd"],
  "extension lead":           ["flexible cord extension", "extension cord"],
  "kitchen":                  ["fixed water container", "zone classification", "water container"],

  // ── Electrical: protection & safety ─────────────────────────────────────────
  "earth leakage breaker":    ["rcd", "residual current device", "rccb"],
  "earth leakage":            ["rcd", "residual current device", "residual current"],
  "safety switch":            ["rcd", "residual current device", "residual current"],
  "elcb":                     ["rcd", "residual current device", "earth leakage circuit breaker"],
  "rcbo":                     ["residual current circuit breaker", "overcurrent protection", "rcd"],
  "circuit breaker":          ["miniature circuit breaker", "mcb", "circuit protective device"],
  "mcb":                      ["miniature circuit breaker", "circuit breaker", "overcurrent"],
  "neutral earth link":       ["men link", "multiple earthed neutral", "neutral-earth"],
  "men link":                 ["multiple earthed neutral", "neutral-earth connection"],
  "men system":               ["multiple earthed neutral system", "tn-c-s"],
  "men":                      ["multiple earthed neutral", "men system"],
  "earth stake":              ["earth electrode", "driven earth electrode"],
  "earth rod":                ["earth electrode", "driven earth electrode"],
  "surge diverter":           ["surge protective device", "spd"],
  "lightning arrestor":       ["lightning protection", "surge arrester", "spd"],

  // ── Electrical: switchboards ─────────────────────────────────────────────────
  "main switchboard":         ["main switchboard", "main distribution board", "msb", "mdb"],
  "sub board":                ["sub-switchboard", "sub-distribution board", "sub-main"],
  "meter box":                ["electricity meter", "metering panel", "consumer mains"],
  "fuse box":                 ["switchboard", "distribution board", "fuse board"],
  "switchboard":              ["switchboard", "distribution board", "consumer mains panel"],
  "main switch":              ["main switch", "isolating switch", "main isolator"],
  "main breaker":             ["main circuit breaker", "main circuit protective device"],
  "neutral bar":              ["neutral link", "neutral bar", "neutral busbar"],
  "earth bar":                ["earthing conductor terminal", "earth busbar", "protective earth"],
  "din rail":                 ["din rail", "35mm mounting rail"],

  // ── Electrical: wiring & cables ─────────────────────────────────────────────
  "tps cable":                ["thermoplastic sheathed", "twin and earth", "flat cable"],
  "twin and earth":           ["thermoplastic sheathed", "tps cable"],
  "flat cable":               ["thermoplastic sheathed", "tps"],
  "three phase and earth":    ["4-core tps", "3-phase cable", "submain cable"],
  "orange flex":              ["heavy duty flexible cord", "tough rubber sheathed"],
  "underground cable":        ["underground feeder", "direct burial", "armoured cable"],
  "swa cable":                ["steel wire armoured", "armoured cable"],
  "meter tails":              ["consumer mains conductors", "service conductors"],
  "submain":                  ["sub-main cable", "feeder cable"],
  "active wire":              ["active conductor", "line conductor"],
  "live wire":                ["active conductor", "line conductor"],
  "active":                   ["active conductor", "line conductor"],
  "neutral":                  ["neutral conductor"],
  "earth wire":               ["protective earthing conductor", "earth conductor", "cpc"],
  "orange conduit":           ["pvc conduit", "direct burial conduit"],
  "grey conduit":             ["pvc conduit", "surface mount conduit"],
  "trunking":                 ["cable trunking", "cable duct"],

  // ── Electrical: testing ──────────────────────────────────────────────────────
  "loop test":                ["earth fault loop impedance", "loop impedance test"],
  "insulation test":          ["insulation resistance test", "ir test", "megger"],
  "megger test":              ["insulation resistance test", "ir test"],
  "megger":                   ["insulation resistance tester", "megohmmeter"],
  "polarity test":            ["polarity test", "verification of polarity"],
  "continuity test":          ["continuity test", "protective conductor resistance"],
  "rcd test":                 ["residual current device test", "operating time test"],
  "test the safety switch":   ["rcd test", "residual current device functional test"],

  // ── Electrical: lighting ─────────────────────────────────────────────────────
  "downlight":                ["recessed luminaire", "luminaire", "ic-f rated"],
  "batten light":             ["surface mounted fluorescent luminaire", "batten luminaire"],
  "fluoro":                   ["fluorescent luminaire", "fluorescent lamp", "fluorescent"],
  "oyster light":             ["surface mounted dome luminaire", "ceiling luminaire"],
  "sensor light":             ["motion activated luminaire", "pir luminaire", "occupancy sensor"],
  "emergency light":          ["emergency luminaire", "exit and emergency"],
  "exit sign":                ["exit sign", "exit luminaire"],
  "dimmer":                   ["dimmer switch", "phase-cut dimmer"],
  "three-way switch":         ["two-way switch", "two-way switching"],
  "two-way switch":           ["two-way switch", "two-way switching"],
  "intermediate switch":      ["intermediate switch", "multi-location switching"],
  "exhaust fan":              ["exhaust fan", "mechanical ventilation unit"],
  "halogen transformer":      ["elv transformer", "12v transformer"],

  // ── Electrical: metering & supply ──────────────────────────────────────────
  "smart meter":              ["advanced metering infrastructure", "ami meter", "interval meter"],
  "off-peak hot water":       ["controlled load tariff", "off-peak tariff"],
  "solar inverter":           ["photovoltaic inverter", "grid-connect inverter", "pv inverter"],
  "solar panels":             ["photovoltaic modules", "solar pv array", "pv modules"],
  "battery storage":          ["battery energy storage system", "bess"],
  "three phase power":        ["three-phase supply", "polyphase supply"],
  "single phase":             ["single-phase supply"],
  "mains power":              ["supply authority mains", "grid supply"],
  "data point":               ["telecommunications outlet", "data outlet", "rj45"],
  "tv point":                 ["television outlet", "antenna outlet", "coaxial outlet"],
  "phone point":              ["telephone outlet", "rj11", "telephone socket"],

  // ── Plumbing: hot water ──────────────────────────────────────────────────────
  "hot water system":         ["water heater", "domestic hot water system", "hws"],
  "hws":                      ["water heater", "domestic hot water system", "hot water system"],
  "continuous flow":          ["instantaneous water heater", "tankless water heater"],
  "rinnai":                   ["instantaneous water heater", "continuous flow"],
  "solar hot water":          ["solar water heater", "solar thermal"],
  "heat pump hot water":      ["heat pump water heater"],
  "tempering valve":          ["tempering valve", "thermostatic mixing valve", "tmv"],
  "tmv":                      ["thermostatic mixing valve", "tempering valve"],
  "relief valve":             ["pressure and temperature relief valve", "ptr valve", "safety valve"],
  "expansion valve":          ["expansion control valve", "thermal expansion relief"],
  "plv":                      ["pressure limiting valve", "pressure reducing valve"],
  "pressure limiting valve":  ["pressure limiting valve", "plv"],
  "cold water inlet":         ["cold water service connection", "cws inlet"],
  "lagging":                  ["pipe insulation", "thermal insulation"],

  // ── Plumbing: pipes & fittings ──────────────────────────────────────────────
  "poly pipe":                ["polyethylene pipe", "pe pipe", "polyethylene pressure pipe"],
  "blue line poly":           ["pe80 polyethylene", "pe pipe cold water"],
  "purple pipe":              ["recycled water pipe", "class 12 pe recycled water"],
  "yellow poly":              ["pe gas pipe", "pe gas distribution pipe"],
  "marley pipe":              ["pvc drainage pipe", "dwv pipe", "upvc drainage"],
  "dwv pipe":                 ["drain waste vent", "sanitary drainage pipe", "dwv"],
  "copper pipe":              ["copper tube", "hard drawn copper tube"],
  "cpvc pipe":                ["chlorinated polyvinyl chloride", "cpvc hot water"],
  "push-on fitting":          ["push-fit coupling", "push-to-connect fitting"],
  "flexi hose":               ["flexible hose connection", "braided flexible hose"],
  "flexi":                    ["flexible hose connection", "flexible coupling"],
  "check valve":              ["non-return valve", "backflow prevention valve", "nrv"],
  "backflow preventer":       ["backflow prevention device", "reduced pressure zone", "rpz"],
  "ball valve":               ["quarter-turn isolating valve", "full bore ball valve"],
  "bsp thread":               ["british standard pipe thread", "bsp", "rp thread"],
  "teflon tape":              ["ptfe thread seal tape", "thread seal tape"],
  "boss white":               ["pipe jointing compound", "thread sealant"],
  "olive":                    ["compression ring", "ferrule"],

  // ── Plumbing: drainage & sanitary ──────────────────────────────────────────
  "dunny":                    ["water closet", "wc", "toilet suite"],
  "toilet suite":             ["wc suite", "close-coupled toilet suite", "water closet"],
  "cistern":                  ["cistern", "flushing cistern", "toilet cistern"],
  "toilet pan":               ["wc pan", "pedestal pan"],
  "dual flush":               ["dual flush cistern"],
  "floor waste":              ["floor waste gully", "floor drain", "fwg"],
  "fwg":                      ["floor waste gully", "floor drain"],
  "gully trap":               ["gully trap", "yard gully"],
  "inspection opening":       ["inspection opening", "io", "cleanout"],
  "io":                       ["inspection opening", "cleanout access"],
  "overflow relief gully":    ["overflow relief gully", "org"],
  "org":                      ["overflow relief gully", "sewer relief gully"],
  "vent pipe":                ["sanitary vent pipe", "vent stack"],
  "discharge stack":          ["discharge stack", "soil stack", "sanitary stack"],
  "grease trap":              ["grease trap", "grease interceptor"],
  "grey water":               ["greywater", "non-toilet wastewater"],
  "sewer":                    ["sewerage system", "sanitary drainage"],
  "drain":                    ["sanitary drain", "drainage"],
  "sink":                     ["fixed water container", "water container", "sink"],
  "kitchen sink":             ["fixed water container", "water container", "sink"],
  "laundry trough":           ["laundry tub", "laundry sink"],
  "tap":                      ["tapware", "tap"],
  "mixer tap":                ["mixer tapware", "single lever mixer"],
  "tap washer":               ["tap washer", "jumper valve washer"],
  "shower rose":              ["shower head", "fixed overhead shower"],
  "wels":                     ["water efficiency labelling", "water efficiency star rating"],

  // ── Gas ─────────────────────────────────────────────────────────────────────
  "lpg":                      ["liquefied petroleum gas", "lpg cylinder"],
  "natural gas":              ["natural gas", "reticulated gas"],
  "gas bottle":               ["lpg cylinder", "gas cylinder"],
  "gas bayonet":              ["gas bayonet fitting", "quick connect gas fitting"],
  "gas cock":                 ["gas valve", "manual gas valve", "gas isolation valve"],
  "gas regulator":            ["gas pressure regulator", "gas service regulator"],
  "csst":                     ["corrugated stainless steel tubing", "gas distribution tubing"],
  "type a appliance":         ["type a gas appliance"],
  "type b appliance":         ["type b gas appliance"],
  "gas certificate":          ["certificate of compliance", "coc"],
  "coc":                      ["certificate of compliance"],
  "tightness test":           ["pressure tightness test", "gas installation tightness test"],
  "purging":                  ["purging", "gas line purging", "gas commissioning"],

  // ── HVAC ─────────────────────────────────────────────────────────────────────
  "split system":             ["split system air conditioner", "room air conditioner", "rac"],
  "reverse cycle":            ["reverse cycle air conditioner", "heat pump air conditioner"],
  "ducted system":            ["ducted air conditioning", "central air conditioning"],
  "multi-head split":         ["multi-split system", "variable refrigerant flow"],
  "vrf system":               ["variable refrigerant flow", "vrv"],
  "vrv":                      ["variable refrigerant volume", "variable refrigerant flow", "vrf"],
  "evap cooler":              ["evaporative cooler", "evaporative air conditioner"],
  "evaporative cooler":       ["evaporative cooler", "evaporative air conditioner"],
  "window rattler":           ["window air conditioner", "room air conditioner"],
  "aircon":                   ["air conditioner", "split system"],
  "air con":                  ["air conditioner", "split system"],
  "hi-wall unit":             ["wall mounted split system", "hi-wall indoor unit"],
  "cassette unit":            ["ceiling cassette fan coil unit", "cassette indoor unit"],
  "outdoor unit":             ["condensing unit", "outdoor condensing unit"],
  "indoor unit":              ["fan coil unit", "fcu", "evaporator unit"],
  "lineset":                  ["refrigerant line set", "refrigerant piping"],
  "top up the gas":           ["refrigerant charge", "recharge refrigerant"],
  "gas leak":                 ["refrigerant leak", "refrigerant charge loss"],
  "arc licence":              ["refrigerant handling licence", "arctick"],
  "arctick":                  ["refrigerant handling authorisation", "arc licence"],
  "r22":                      ["r-22 refrigerant", "hcfc-22"],
  "r410a":                    ["r-410a refrigerant", "hfc refrigerant"],
  "r32":                      ["r-32 refrigerant"],
  "txv":                      ["thermostatic expansion valve"],
  "eev":                      ["electronic expansion valve"],
  "cool room":                ["cold room", "walk-in cool room", "refrigerated"],
  "freezer room":             ["walk-in freezer", "blast freezer"],
  "flexi duct":               ["flexible duct", "flexible air duct"],
  "diffuser":                 ["supply air diffuser", "ceiling diffuser"],
  "fresh air unit":           ["energy recovery ventilator", "erv", "hrv", "mechanical fresh air"],
  "static pressure":          ["static pressure", "system resistance"],
  "esp":                      ["external static pressure"],

  // ── Building ─────────────────────────────────────────────────────────────────
  "slab":                     ["concrete slab", "slab on ground", "suspended slab"],
  "sog":                      ["slab on ground", "ground-supported slab"],
  "footings":                 ["footings", "strip footings", "pad footings", "foundation footings"],
  "strip footing":            ["strip footing", "continuous wall footing"],
  "pad footing":              ["isolated pad footing", "column footing"],
  "waffle pod slab":          ["waffle pod raft slab", "waffle raft footing"],
  "waffle pod":               ["waffle pod raft slab", "ribbed slab with void formers"],
  "raft slab":                ["raft footing", "raft foundation"],
  "stumps":                   ["stumps", "piers", "foundation piers"],
  "bearers and joists":       ["bearers and joists", "floor framing"],
  "reo":                      ["reinforcing steel", "reinforcement", "rebar"],
  "reo bar":                  ["reinforcing bar", "deformed bar", "n-grade bar"],
  "mesh":                     ["steel reinforcing mesh", "reinforcing mesh", "f-mesh"],
  "f-mesh":                   ["reinforcing mesh", "steel mesh"],
  "n bar":                    ["n-grade deformed reinforcing bar", "deformed bar"],
  "cover":                    ["concrete cover", "minimum cover to reinforcement"],
  "slump":                    ["concrete slump", "workability"],
  "pump mix":                 ["pumpable concrete mix"],
  "blue metal":               ["blue metal aggregate", "crushed basalt aggregate", "coarse aggregate"],
  "crusher dust":             ["crusher dust", "crushed rock fines"],
  "road base":                ["road base material", "crushed rock road base"],
  "dpc":                      ["damp proof course", "moisture barrier"],
  "ant cap":                  ["ant cap", "termite cap", "termite barrier"],
  "termite barrier":          ["termite management system", "physical termite barrier"],
  "nogging":                  ["nogging", "horizontal blocking", "dwang"],
  "stud":                     ["stud", "wall stud"],
  "top plate":                ["top plate", "wall plate"],
  "bottom plate":             ["bottom plate", "sole plate"],
  "lintel":                   ["lintel", "door lintel", "window lintel"],
  "trimmer stud":             ["trimmer stud", "jack stud"],
  "truss":                    ["roof truss", "prefabricated truss"],
  "rafter":                   ["rafter", "common rafter"],
  "ceiling joist":            ["ceiling joist", "flat ceiling framing"],
  "purlin":                   ["purlin", "horizontal roof framing"],
  "underpurlin":              ["underpurlin"],
  "collar tie":               ["collar tie", "rafter tie"],
  "bearer":                   ["bearer", "floor bearer"],
  "joist":                    ["floor joist", "framing member"],
  "lvl":                      ["laminated veneer lumber", "engineered wood"],
  "glulam":                   ["glued laminated timber", "glt"],
  "mgp10":                    ["machine graded pine mgp10", "stress grade mgp10"],
  "mgp12":                    ["machine graded pine mgp12"],
  "seasoned timber":          ["seasoned timber", "kiln dried timber"],
  "green timber":             ["unseasoned timber", "green timber"],
  "h2 treatment":             ["h2 preservative treatment", "hazard level h2"],
  "h3 treatment":             ["h3 preservative treatment", "hazard level h3"],
  "h4 treatment":             ["h4 preservative treatment", "hazard level h4"],
  "h5 treatment":             ["h5 preservative treatment", "hazard level h5"],
  "tin roof":                 ["steel sheet roofing", "corrugated steel roofing", "metal roofing"],
  "colorbond":                ["pre-painted steel roofing", "steel sheet roofing"],
  "corrugated iron":          ["corrugated steel roofing", "corrugated sheet metal roofing"],
  "terracotta tiles":         ["terracotta roof tiles", "clay roof tiles"],
  "concrete tiles":           ["concrete roof tiles", "monier tiles"],
  "monier tile":              ["concrete roof tile"],
  "sarking":                  ["sarking", "roof sarking membrane", "reflective foil laminate", "rfl"],
  "rfl":                      ["reflective foil laminate", "foil-faced sarking"],
  "plasterboard":             ["plasterboard", "gypsum plasterboard"],
  "gyprock":                  ["plasterboard", "gypsum plasterboard"],
  "cornice":                  ["cornice", "plasterboard cornice", "cove cornice"],
  "render":                   ["cement render", "external render"],
  "wet area":                 ["wet area", "bathroom", "laundry", "damp situation"],
  "tanking":                  ["waterproofing membrane", "wet area waterproofing"],
  "besser block":             ["concrete masonry unit", "concrete block", "hollow concrete"],
  "hebel":                    ["autoclaved aerated concrete", "aac"],
  "aac":                      ["autoclaved aerated concrete", "hebel"],
  "brick veneer":             ["brick veneer", "masonry veneer"],
  "double brick":             ["double leaf masonry", "cavity masonry"],
  "full brick":               ["double brick construction", "cavity brick"],
  "mortar":                   ["mortar", "masonry mortar", "bedding mortar"],
  "weephole":                 ["weephole", "drainage weephole"],
  "wall tie":                 ["masonry wall tie", "brick tie", "cavity wall tie"],
  "tuckpointing":             ["tuckpointing", "repointing mortar joints"],
  "ag pipe":                  ["agricultural pipe", "slotted drainage pipe", "sub-surface drainage"],
  "geotextile":               ["geotextile fabric", "filter fabric"],
  "retaining wall":           ["retaining wall", "soil retaining structure"],
  "chipboard":                ["particleboard", "particle board flooring"],
  "particleboard flooring":   ["particleboard flooring", "chipboard flooring"],
  "blueboard":                ["fibre cement sheet", "fc sheet"],
  "villaboard":               ["fibre cement sheet", "thin fibre cement"],
  "fc sheet":                 ["fibre cement sheet"],
  "cfc":                      ["compressed fibre cement"],
  "floating floor":           ["floating floor", "click-lock flooring"],
  "balustrade":               ["balustrade", "handrail system"],
  "pool fence":               ["swimming pool safety barrier", "pool safety fence"],
  "stormwater":               ["stormwater drainage", "surface water drainage"],
  "whirlybird":               ["rotary wind ventilator", "turbine roof vent", "roof ventilator"],

  // ── Compliance & safety ──────────────────────────────────────────────────────
  "swms":                     ["safe work method statement", "job safety analysis"],
  "jsa":                      ["job safety analysis", "safe work method statement"],
  "sds":                      ["safety data sheet"],
  "msds":                     ["safety data sheet", "material safety data sheet"],
  "white card":               ["construction induction card", "site induction"],
  "hrwl":                     ["high risk work licence"],
  "ncc":                      ["national construction code", "building code of australia"],
  "bca":                      ["building code of australia", "national construction code"],
  "da":                       ["development approval", "development application"],
};


/**
 * Expand a user query using tradie synonyms.
 * Returns expanded keywords (for keyword search) and an expanded text string
 * (for a second vector search pass).
 */
export function expandQuery(query: string): {
  keywords: string[];
  expandedText: string;
  matchedPhrases: string[];
} {
  const lower = query.toLowerCase();
  const addedStandardTerms: string[] = [];
  const matchedPhrases: string[] = [];

  // Sort by phrase length descending so multi-word phrases are checked first
  const sorted = Object.keys(TRADIE_SYNONYMS).sort((a, b) => b.length - a.length);

  for (const phrase of sorted) {
    if (lower.includes(phrase)) {
      matchedPhrases.push(phrase);
      addedStandardTerms.push(...TRADIE_SYNONYMS[phrase]);
    }
  }

  // Original single-word keywords (length > 2)
  const originalKeywords = lower.split(/\s+/).filter((w) => w.length > 2);

  // Flatten expanded terms into individual words too
  const expandedWords = addedStandardTerms
    .flatMap((t) => t.toLowerCase().split(/[\s\-\/]+/))
    .filter((w) => w.length > 2);

  const keywords = [...new Set([...originalKeywords, ...expandedWords])];

  const expandedText =
    addedStandardTerms.length > 0
      ? `${query} ${addedStandardTerms.join(" ")}`
      : query;

  return { keywords, expandedText, matchedPhrases };
}
