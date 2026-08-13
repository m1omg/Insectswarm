// Generates SCIENCE.md from the scenarios' own PARAMS and NOTES tables.
//
// The point of generating it rather than writing it is that the document cannot drift away from
// the simulation. Every number here is the number the code runs on, and if a constant loses its
// citation the build fails rather than quietly publishing an unsourced figure.
//
//   node tools/build-science.js            write SCIENCE.md
//   node tools/build-science.js --check     fail if SCIENCE.md is out of date
//
// Imports only the module-level exports, so it never touches a canvas and needs no browser.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const SCENARIOS = ['ants', 'honeybees', 'wasps', 'termites'];

/** Anything whose source says `tuned` is a simulation choice, not a measurement. */
const isTuned = (source) => /^\s*tuned\b/i.test(source);

function formatValue(param) {
  const { value, unit } = param;
  const shown = Number.isInteger(value) ? String(value) : String(value);
  if (!unit || unit === '') return shown;
  if (unit === 'true/false') return value ? 'yes' : 'no';
  return `${shown} ${unit}`;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

async function build() {
  const lines = [];
  const problems = [];

  lines.push('# The science behind Insectswarm');
  lines.push('');
  lines.push('This file is generated from the simulation\'s own parameter tables by');
  lines.push('`node tools/build-science.js` — every figure below is the figure the code runs on. It cannot');
  lines.push('drift away from the model, because it is read out of the model.');
  lines.push('');
  lines.push('Two conventions matter when reading it:');
  lines.push('');
  lines.push('- A row marked **tuned** is a simulation choice, not a measurement. Some are display');
  lines.push('  conveniences, some are numbers nobody has published; either way they are labelled so you');
  lines.push('  never have to guess which is which.');
  lines.push('- Where the underlying science is genuinely unsettled, the source column says so rather than');
  lines.push('  picking a winner. The termite "cement pheromone" is the clearest case.');
  lines.push('');

  let totalParams = 0;
  let tunedParams = 0;

  for (const id of SCENARIOS) {
    const mod = await import(`../src/sim/scenarios/${id}.js`);
    const { meta, PARAMS, NOTES } = mod;

    lines.push(`## ${meta.name} — *${meta.species}*`);
    lines.push('');
    lines.push(meta.blurb);
    lines.push('');
    lines.push('| Parameter | Value | Source |');
    lines.push('| --- | --- | --- |');

    for (const [key, param] of Object.entries(PARAMS)) {
      totalParams++;
      if (!param.source) {
        problems.push(`${id}.PARAMS.${key} has no source`);
        continue;
      }
      if (isTuned(param.source)) tunedParams++;

      const label = param.label || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
      const marker = isTuned(param.source) ? ' *(tuned)*' : '';
      lines.push(`| ${escapeCell(label)}${marker} | ${escapeCell(formatValue(param))} | ${escapeCell(param.source)} |`);
    }

    lines.push('');
    lines.push('### Notes');
    lines.push('');
    for (const note of NOTES) {
      if (!note.text || !note.source) {
        problems.push(`${id} has a note without text or source`);
        continue;
      }
      lines.push(`- ${note.text}`);
      lines.push(`  — *${note.source}*`);
    }
    lines.push('');
  }

  lines.push('## Honest accounting');
  lines.push('');
  lines.push(`Across the four colonies there are **${totalParams}** parameters, of which **${tunedParams}**`);
  lines.push('are marked `tuned` rather than sourced to a measurement. Those are mostly walking speeds,');
  lines.push('display time-compressions and a handful of rates nobody appears to have published.');
  lines.push('');
  lines.push('Two distortions apply to every scenario and are worth stating plainly:');
  lines.push('');
  lines.push('- **Time is compressed.** Insects move in seconds and colonies live over months, and no');
  lines.push('  single rate shows both. Locomotion runs in simulated real time while the calendar is');
  lines.push('  accelerated to a minute or two per day. A foraging trip therefore takes a much larger');
  lines.push('  share of the day here than in life. Each scenario exposes the compression as a slider.');
  lines.push('- **Colonies are small.** A honey bee hive holds twenty to fifty thousand bees and a');
  lines.push('  *Macrotermes* mound over a million. These hold a few hundred, so that a phone can draw');
  lines.push('  them. Rates per individual are real; totals are not.');
  lines.push('');

  const out = `${lines.join('\n')}\n`;

  if (problems.length) {
    console.error('Refusing to generate — a constant without a citation is a bug:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  const target = join(root, 'SCIENCE.md');
  if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== out) {
      console.error('SCIENCE.md is out of date. Run: node tools/build-science.js');
      process.exitCode = 1;
      return;
    }
    console.log(`SCIENCE.md is up to date (${totalParams} parameters, ${tunedParams} tuned).`);
    return;
  }

  writeFileSync(target, out);
  console.log(`Wrote SCIENCE.md — ${totalParams} parameters, ${tunedParams} marked tuned.`);
}

build();
