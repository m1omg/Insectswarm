# Insectswarm

A browser simulation of four social-insect colonies — garden ants, honey bees, common wasps and
mound-building termites — where each colony is coordinated by the mechanism the real animal
actually uses. The contrast between those mechanisms is the point of the project.

## Running it

There is no build step and there are no dependencies. Serve the repo root and open it:

```sh
python3 -m http.server 8000        # then open http://localhost:8000
node --test test/*.test.js         # unit and behavioural tests
node tools/build-science.js        # regenerate SCIENCE.md from the PARAMS tables
node tools/build-science.js --check   # fail if SCIENCE.md has drifted (CI runs this)
```

ES modules need a real HTTP origin, so `file://` will not work. Anything that serves static files
is fine. The repo deploys to GitHub Pages unchanged.

## Layout

```
index.html            markup + all CSS
src/main.js           bootstrap, scenario registry, UI wiring
src/engine/           generic, insect-agnostic machinery
src/sim/              shared biology (colony, brood, castes, seasons, steering)
src/sim/scenarios/    the four colonies
test/                 node:test unit tests for pure functions
```

`engine/` must not know anything about insects. `sim/` must not touch the DOM. Only `main.js` and
`engine/ui.js` are allowed to read or write the document.

## Rules that matter

**Every biological constant carries a citation.** Constants live in a per-scenario `PARAMS` table as
`{value, unit, source}` — never as a bare number inline. `SCIENCE.md` and the in-app science panel
are generated from those tables. A constant without a `source` is a bug. If a number is a
gameplay-motivated invention rather than a measurement, mark it `source: 'tuned'` so it is honest
about not being science.

**Where the science is unsettled, say so.** The termite "cement pheromone" has never been chemically
identified. Model the current leading explanation, expose the alternatives as toggles, and state the
uncertainty in the science panel. Do not launder a hypothesis into a fact.

**The simulation never reads wall-clock time.** `loop.js` calls `step(dt)` with a constant `dt`, and
simulation code may only advance state from that argument. No `Date.now()`, no `performance.now()`,
no `Math.random()` below `engine/` — use the seeded RNG. This is what makes the sim identical at
30 Hz, 60 Hz and 144 Hz, and it is covered by a test. Rendering may interpolate with the leftover
accumulator fraction; it must never mutate simulation state.

**Typed arrays and pooling in the hot path.** Agents are stored struct-of-arrays; fields are
`Float32Array` grids. Do not allocate objects per agent per tick — a colony is thousands of
individuals at 60 Hz on a phone.

**Touch and mouse share one code path.** Pointer Events only. No `mousedown`/`touchstart`, no
hover-only affordances, and interactive targets are at least 44 px.

## Conventions

- Plain ES modules, `const`/`let`, no transpilation, no framework. Modern syntax is fine; anything
  shipping in current Safari, Chrome and Firefox is fair game.
- Angles are radians and stored as world-space bearings; convert only at the edges.
- Distances are metres, times are seconds, temperatures are °C. Convert to pixels in the renderer,
  never in the simulation.
- Comment the biology, not the JavaScript. `// waggle run angle is measured from vertical, which
  represents the sun azimuth` earns its place; `// increment i` does not.

## Adding a scenario

Implement the interface in `src/sim/scenarios/` — `init(world, rng)`, `step(dt)`, `describe()` for
the inspector, a `PARAMS` table with sources, and a `NOTES` array for the science panel. Register it
in `main.js`. The engine and shared sim should need no changes; if they do, that is a sign the
abstraction is wrong and belongs in `sim/`.
