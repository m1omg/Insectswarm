# The science behind Insectswarm

This file is generated from the simulation's own parameter tables by
`node tools/build-science.js` — every figure below is the figure the code runs on. It cannot
drift away from the model, because it is read out of the model.

Two conventions matter when reading it:

- A row marked **tuned** is a simulation choice, not a measurement. Some are display
  conveniences, some are numbers nobody has published; either way they are labelled so you
  never have to guess which is which.
- Where the underlying science is genuinely unsettled, the source column says so rather than
  picking a winner. The termite "cement pheromone" is the clearest case.

## Anthill — *Lasius niger*

Mass recruitment. Foragers lay an evaporating trail; the route that pays keeps getting reinforced, and the colony converges on it without any ant ever comparing two routes.

| Parameter | Value | Source |
| --- | --- | --- |
| Trail half-life | 45 min | Beckers, Deneubourg & Goss (1992) estimate a trail lifetime of ~47 min in Lasius niger. Compare Pharaoh ant at 25 min on plastic and 8 min on paper (Jeanson et al. 2003). |
| Choice sharpness n | 2 | Deneubourg, Aron, Goss & Pasteels (1990), J. Insect Behavior 3:159-168. |
| Choice threshold k | 0.4 trail units | Deneubourg et al. (1990) fit k = 20, but in the concentration units of their assay. k is a unit conversion, not a dimensionless constant, so it is recalibrated here to this simulation's pheromone units — set so the "effectively random" threshold falls at the same place relative to a working trail (which runs 2-5 units here). The functional form and the exponent n are the science; k is bookkeeping. |
| Deposit bias near food | 20 x | Popp & Czaczkes (2024), Insectes Sociaux: L. niger deposits up to ~22x more pheromone within 10 cm of the food than on the final approach to the nest. |
| Walk Speed *(tuned)* | 0.03 m/s | tuned — within the few-cm/s range typical of Lasius foragers on level ground. |
| Colony Size | 5500 workers | Mean mature colony size for L. niger; field colonies range to 15,000-40,000 workers. |
| Egg Days | 15 d | L. niger eggs hatch in 10-20 days depending on temperature. |
| Larva Days | 19 d | Larval period 14-24 days; egg to adult totals 6-10 weeks. |
| Pupa Days | 17 d | Pupal period 14-21 days; faster at the upper end of the range. |
| Brood optimum | 25 °C | Development is fastest around 24-25 °C, which is why colonies move brood up under warm stones in summer and down again at night. |
| Brood Base C *(tuned)* | 12 °C | tuned — developmental zero; below this brood makes no measurable progress. |
| Forager Age Days *(tuned)* | 20 d | tuned — Lasius shows the usual age polyethism, with older workers moving to outside work. |
| Antenna Spread *(tuned)* | 0.0015 m | tuned — roughly the antennal separation of a 4 mm worker; sets trail-following precision. |
| U-turn rate off-trail | 0.35 /s | Ants U-turn markedly less on a rewarding trail than off it (Beckers et al. 1992). |
| Day length *(tuned)* | 120 s/day | tuned — display compression, see the note on the two clocks. |

### Notes

- Nothing in this simulation tells an ant which route is shorter. Each returning forager lays pheromone, each departing forager is biased towards stronger pheromone, and the pheromone evaporates. A shorter route is walked more times per hour, so it is topped up more often than it evaporates. The colony chooses; no ant does.
  — *Goss, Aron, Deneubourg & Pasteels (1989), Self-organized shortcuts in the Argentine ant.*
- At a fork, the chance of taking a branch follows P = (k+C)^n / sum, with n = 2. That exponent is what makes the colony commit: a branch with modestly more pheromone takes much more than a modestly larger share of the traffic. Turn n down towards 1 and the colony dithers between routes forever. Here the rule is applied to the ring of directions an ant faces at the nest mouth, which is the same decision with more branches.
  — *Deneubourg, Aron, Goss & Pasteels (1990), J. Insect Behavior 3:159-168.*
- One honest caveat about that formula: the published k = 20 is in the concentration units of the original assay, which are not the units of this pheromone grid. k is a unit conversion rather than a constant of nature, so it has been recalibrated here to put the "too faint to tell apart" threshold in the same place relative to a working trail. The shape of the response and the exponent are the science; k is bookkeeping.
  — *Simulation calibration note.*
- Ants do not read the gradient at a point — they sweep two antennae and turn towards whichever finds more. That is why trail following is visibly wobbly at low concentrations and crisp at high ones.
  — *Modelled after bilateral trail-following in Lasius; Hangartner (1967) onwards.*
- Deposition is not uniform along the route. A laden ant lays far more pheromone close to the food than on the final approach to the nest — up to about twenty times more.
  — *Popp & Czaczkes (2024), Insectes Sociaux 71.*
- In the cutaway, nurses carry brood up and down the soil profile chasing about 25 °C, where development runs fastest. Watch the brood pile rise towards the surface through the afternoon and sink again overnight. Real colonies do exactly this, which is why you find brood under a warm paving slab.
  — *Standard Lasius natural history; development rate peaks near 24-25 °C.*
- Two clocks run at once. Ants walk in real time, but the calendar is compressed to a couple of minutes per day so a season is watchable. A foraging trip therefore eats a much larger share of the day here than it does in life. That is a display convenience and not biology — the day-length slider controls it.
  — *Simulation design choice.*

## Bee hive — *Apis mellifera*

A symbolic language and a queue. Foragers dance the distance and compass bearing of flowers, and decide whether to dance at all from how long they waited to be unloaded.

| Parameter | Value | Source |
| --- | --- | --- |
| Dance seconds per km | 1 s/km | Waggle run duration rises with distance at roughly 1 s per km. The relationship is better fitted by two straight segments meeting near 1 km than by one line (non-linear waggle duration functions, PMC8029670). |
| Dance angular scatter | 13 ° | Successive waggle runs vary by roughly 10-15° about their mean, so recruits arrive spread around the patch rather than on it. The scatter is thought to spread a colony across a flower patch rather than being simple error. |
| Dance Distance Error *(tuned)* | 0.11 fraction | tuned — recruits overshoot and undershoot; the odometer is known to be imprecise and somewhat miscalibrated (arXiv 2405.12998). |
| Waggle if unloaded within | 20 s | Seeley: a forager unloaded in under ~20 s treats receivers as idle and waggle dances. |
| Tremble if waiting beyond | 50 s | Seeley: waiting beyond ~50 s to be unloaded triggers the tremble dance, which recruits more receivers and damps further foraging. Between 20 and 50 s she simply waits. |
| Brood nest target | 35 °C | The brood nest is held at 34.5-35.5 °C, among the most tightly regulated temperatures in any animal society. |
| Flight Speed | 6.5 m/s | Foraging flight is around 6-7 m/s (roughly 25 km/h) in still air. |
| Crop Capacity | 40 mg | A honey stomach holds around 40 mg of nectar, close to half the bee’s body mass. |
| Egg Days | 3 d | Worker egg stage is 3 days at brood-nest temperature. |
| Larva Days | 6 d | Worker larval stage is about 6 days before capping. |
| Pupa Days | 12 d | Capped pupal stage is about 12 days; 21 days egg to adult. |
| Age at first foraging | 21 d | Age polyethism: cleaning to about day 2, nursing to day 11, receiving and comb building to day 17, guarding to day 20, foraging from about day 21. |
| Dance Follower Age Days | 8 d | Bees younger than about 8 days do not follow dances. |
| Day length *(tuned)* | 150 s/day | tuned — display compression, as in the other colonies. |

### Notes

- The waggle run is a sentence with two words. Its duration says how far — about a second per kilometre — and its angle away from straight up says which way, measured from the sun rather than from north. Tap a dancer to read what she is currently saying.
  — *von Frisch (1967); duration-distance fits from PMC8029670.*
- Because the reference direction is the sun, and the sun moves about 15° an hour, a dance for one patch rotates across the day. Watch a dancer through a simulated afternoon and her run angle turns while the flowers stay where they are. Bees re-reference continuously, which is why the instruction stays correct.
  — *von Frisch (1967); sun azimuth modelled from date and latitude.*
- Successive waggle runs disagree with each other by 10-15°, so followers arrive spread around the target rather than on top of it. This looks like sloppiness and may not be: a flower patch is an area, and scatter spreads the colony across it.
  — *Dance angular divergence; see Tanner & Visscher and later work.*
- The regulation loop is the part people miss. A forager cannot store her own nectar — she must find a receiver. Unloaded inside 20 seconds, she waggle dances and brings more foragers. Kept waiting beyond 50 seconds, she tremble dances instead, which recruits more receivers and damps foraging. The length of a queue nobody measures is what balances the colony’s workforce.
  — *Seeley (1992, 1995), The Wisdom of the Hive.*
- The stop signal is the negative half of the same system: a brief vibration delivered to dancers advertising a place that turned out to be crowded or dangerous. Recruitment in a hive has a brake as well as an accelerator.
  — *Nieh (2010); see also the anti-waggle dance review, Front. Ecol. Evol. 3:14.*
- The brood nest is held between about 34.5 and 35.5 °C. Below it, bees uncouple their flight muscles and shiver; above it they fan, and water foragers are recruited so that evaporation can carry the heat away. Chilled brood develops slowly and emerges damaged.
  — *Brood nest thermoregulation; see Tautz and Seeley.*
- This hive is a few hundred bees rather than the twenty to fifty thousand of a real summer colony — enough to show the mechanisms without asking a phone to draw a stadium crowd. Rates per bee are real; totals are not.
  — *Simulation scale note.*

## Wasp nest — *Vespula vulgaris*

No trails and no dances. Wasps forage alone and recruit only by provoking each other, and the adults live on sugar secreted by their own larvae.

| Parameter | Value | Source |
| --- | --- | --- |
| Season total | 5500 individuals | A successful Vespula vulgaris nest produces roughly 3,000-8,000 individuals across the whole annual cycle (Richards 1971, Biol. Rev. 46). |
| Nest activation strength | 0.35 /arrival | Returning foragers activate nestmates to search for the same food odour, without transferring any location information (Insectes Sociaux 62, 2015: nest-based information transfer and foraging activation in Vespula vulgaris). |
| Local enhancement radius | 18 m | Wasps are drawn to conspecifics already feeding, which concentrates arrivals at a good patch without any signal passing between them. |
| Flight Speed *(tuned)* | 5 m/s | tuned — Vespula cruising flight is a few metres per second. |
| Saliva per larva per day | 2 mg/day | Larvae secrete a sugar- and amino-acid-rich saliva which adults consume during trophallaxis; this is a principal carbohydrate source for adult wasps. Rate is tuned, the dependency is not (Hunt et al.; hornet larval saliva, J. Insect Physiol. 1991). |
| Adults Lack Proteases | yes | Adult vespines cannot digest solid protein themselves — the larvae do it for them, which is what makes the exchange obligatory rather than merely convenient. |
| Prey Per Larva Day *(tuned)* | 2.4 mg/day | tuned — a growing larva needs a steady supply of masticated insect prey. |
| Egg Days | 6 d | Vespula eggs hatch in about 5-8 days. |
| Larva Days | 14 d | Larval development takes roughly 12-20 days. |
| Pupa Days | 13 d | The pupal stage lasts about 12-14 days. |
| Switch to sexuals | 228 day of year | From mid-August the colony stops rearing workers and rears gynes and males instead; this decision ends the colony’s year. |
| Day length *(tuned)* | 90 s/day | tuned — display compression. Shorter here than the other colonies because the whole point of this nest is its annual arc. |

### Notes

- Watch this colony next to the ants. There is no pheromone overlay to switch on here, because there is nothing to show: Vespula lays no recruitment trail. Foragers find prey individually and return to it from memory. The traffic that builds at a good patch is made of wasps who were provoked into searching and then spotted each other, not wasps who were told where to go.
  — *Nest-based information transfer and foraging activation in Vespula vulgaris, Insectes Sociaux 62 (2015).*
- Adult wasps cannot digest protein. They have no proteases, so the caterpillars they hunt are of no direct use to them — the prey goes to the larvae, and the larvae secrete a sugary saliva that the adults drink. The brood is the colony’s digestive system, and the adults are entirely dependent on it.
  — *Vespine trophallaxis; hornet larval saliva composition, J. Insect Physiol. 37 (1991).*
- That dependency is what makes autumn wasps a nuisance. Once the queen switches to rearing gynes and stops laying worker eggs, the larvae dwindle and the saliva supply fails. Thousands of adults still need sugar and now have no source at home, so they go looking for it — at ivy, windfall fruit, and your drink. Nothing in this simulation scripts that: set the season running and watch the sugar column switch over.
  — *Emergent from the modelled larval-saliva economy.*
- The nest itself is chewed wood. Foragers rasp fibre from fence posts and dead timber, mix it with saliva and add it to the comb and to the layered paper envelope, so the nest you see grows only as fast as pulp is brought home.
  — *Standard vespine nest construction.*
- A colony that reaches autumn in good order produces new queens, and only they survive the winter — the workers, the males and the old queen all die. Rearing gynes is the only thing the year was for.
  — *Vespula annual cycle; Richards (1971).*

## Termite mound — *Macrotermes*

Blind builders and a fungus farm. Nobody has a plan: each termite responds to what the mound already is, and pillars become arches become walls.

| Parameter | Value | Source |
| --- | --- | --- |
| Cue: recent deposits | 1 weight | The classical "cement pheromone" hypothesis: soil already deposited carries a marker that stimulates further deposition, giving positive feedback. Never chemically identified — see the note on uncertainty. |
| Cue: surface curvature | 1 weight | Calovi et al. (2019), Proc. R. Soc. B 286:20182588 — surface curvature guides early construction activity in mound-building termites; deposition favours convex points. |
| Cue: evaporation | 1 weight | Facchini et al. (2023), eLife 12:e86843 — substrate evaporation drives collective construction in termites. |
| Deposit cue half-life *(tuned)* | 12 min | tuned — how long a fresh deposit keeps attracting more. Short half-lives give scattered lumps, long ones give a few tall pillars. |
| Soldiers | 0.14 fraction | Macrotermes gilvus censuses give roughly 42% workers, 43% larvae and 14% soldiers (Ann. Entomol. Soc. Am. 105:427). |
| Larva Fraction | 0.43 fraction | As above — larvae are the largest single class in the colony. |
| Colony Size | 33500 individuals | Medium Macrotermes gilvus mounds held 33,500 +/- 2,400 individuals; large ones over 61,000 (Ann. Entomol. Soc. Am. 105:427). |
| CO2 the colony tolerates | 3 % | Nest air runs about 2% lower in oxygen than outside, with CO2 reaching up to ~6% — far beyond what would kill most insects. |
| Medium Mound Air Per Day | 1200 L/day | A large colony of roughly 2 million termites needs on the order of 1,200 L of air a day; big Macrotermes jeanneli mounds vent 800-1,500 L of CO2 daily. |
| Fungus comb optimum | 30 °C | Termitomyces combs are held close to 30 °C; mound architecture correlates with the temperature the symbiont needs (PMC6339472). |
| Worker Speed *(tuned)* | 0.02 m/s | tuned — a Macrotermes worker is a slow walker, and blind. |
| Day length *(tuned)* | 120 s/day | tuned — display compression. |

### Notes

- Grassé invented the word stigmergy for these animals. It means coordination through the work itself: a termite does not take instructions, it reacts to the state of the building, and its reaction changes that state for whoever comes next. Watch pillars appear at random, then lean and meet. No termite ever intended an arch.
  — *Grassé (1959); Insectes Sociaux 6:41-80.*
- Here is the honest part. The "cement pheromone" that supposedly drives all this has never been chemically identified. It has been the textbook explanation since the 1950s, and it may be right, but it remains a hypothesis with no isolated compound behind it. This simulation therefore does not treat it as fact: it is one of three switchable cues, and you can turn it off and watch the mound still get built.
  — *Reviewed in Excavation and aggregation as organizing factors in de novo construction, Proc. R. Soc. B 284:20162730.*
- The second cue is geometric. Termites deposit preferentially where the surface curves sharply — on the tips of things — which turns any accidental bump into a pillar without needing a chemical at all.
  — *Calovi et al. (2019), Proc. R. Soc. B 286:20182588.*
- The third is about water. Fresh soil pellets are wet, and where evaporation is fastest is where termites build. On this account the "pheromone" may largely have been humidity all along. Turn the three cues on and off in any combination and compare the mounds you get.
  — *Facchini et al. (2023), eLife 12:e86843.*
- The mound is not a nest — the colony lives below it. It is a lung. Metabolism from the termites and their fungus pushes warm, CO2-rich air up through the middle, and it cools and sinks through the porous outer walls. A big colony shifts on the order of a thousand litres of air a day this way, and holds CO2 at a few per cent, which would kill most insects outright.
  — *Thermoregulation and ventilation of termite mounds, Naturwissenschaften 89:232.*
- These termites cannot digest wood on their own. They farm a fungus, Termitomyces, on combs built from their own faeces, and eat its nodules. The queen and the youngest larvae live almost entirely on fungal material. Foragers bringing in grass and litter are feeding the fungus, not themselves.
  — *Caste-specific nutritional differences in African termite mounds, Sci. Rep. 9:17383.*

## Honest accounting

Across the four colonies there are **53** parameters, of which **13**
are marked `tuned` rather than sourced to a measurement. Those are mostly walking speeds,
display time-compressions and a handful of rates nobody appears to have published.

Two distortions apply to every scenario and are worth stating plainly:

- **Time is compressed.** Insects move in seconds and colonies live over months, and no
  single rate shows both. Locomotion runs in simulated real time while the calendar is
  accelerated to a minute or two per day. A foraging trip therefore takes a much larger
  share of the day here than in life. Each scenario exposes the compression as a slider.
- **Colonies are small.** A honey bee hive holds twenty to fifty thousand bees and a
  *Macrotermes* mound over a million. These hold a few hundred, so that a phone can draw
  them. Rates per individual are real; totals are not.

