# Insectswarm

Four social-insect colonies, simulated in a browser, each coordinated by the mechanism the real
animal actually uses.

Ants lay pheromone trails and let evaporation pick the shortest path. Honey bees dance a symbolic
map of the landscape and regulate their workforce by how long a forager waits to be unloaded. Wasps
have no trail language at all — they forage alone, and their larvae feed the adults. Termites are
blind and build a two-metre climate-controlled tower by responding to what other termites have
already built. Watching those four strategies side by side is the point of the project.

## Running it

No build step, no dependencies, nothing to install.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

ES modules need a real HTTP origin, so opening `index.html` from the filesystem will not work. Any
static file server is fine, and the repo deploys to GitHub Pages unchanged.

To run the tests (no browser, no dependencies). Most of them check the biology rather than the
code — that a trail forms and then fades, that bees switch from waggling to trembling when the hive
cannot keep up, that termites build nothing at all when every building cue is switched off:

```sh
node --test test/*.test.js
```

`SCIENCE.md` is generated from the simulation's own parameter tables, so it cannot drift away from
what the model actually does:

```sh
node tools/build-science.js
```

## The four colonies

| | Species | Coordinated by |
|---|---|---|
| **Anthill** | *Lasius niger* | Mass recruitment on evaporating pheromone trails |
| **Bee hive** | *Apis mellifera* | The waggle dance, plus queueing-delay feedback |
| **Wasp nest** | *Vespula vulgaris* | Solitary foraging, local enhancement, and larval trophallaxis |
| **Termite mound** | *Macrotermes* | Stigmergy — building on what has already been built |

## How faithful is it?

Every biological constant in the simulation carries a citation to the measurement it came from, and
those citations are visible in the app's science panel and collected in [`SCIENCE.md`](SCIENCE.md).
Numbers that are gameplay inventions rather than measurements are labelled `tuned`, so it is always
clear which is which.

Where the underlying science is genuinely unsettled, the simulation says so rather than picking a
side. The termite "cement pheromone" is the clearest case: it has been the textbook explanation for
mound building since the 1950s and has never been chemically identified. The simulation implements
it alongside the two leading modern alternatives — surface curvature and evaporation gradients — and
lets you switch between them to see how differently the mound grows.

## Controls

Mouse, touch and stylus all take the same path, so everything works on a phone.

- **Drag** to pan, **pinch** or **scroll** to zoom — each pane has its own camera
- **Tap** an individual to inspect its caste, age, task and internal state
- **Long press** (or right click) to use the selected sandbox tool
- **Space** play/pause, **.** single step, **F** reset view, **R** restart, **1–4** switch colony

## Licence

MIT
