// The project's central promise: every biological constant carries a citation, and the published
// SCIENCE.md is generated from the same tables the simulation runs on rather than written by hand.
// These tests are what stop that promise quietly rotting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import * as ants from '../src/sim/scenarios/ants.js';
import * as honeybees from '../src/sim/scenarios/honeybees.js';
import * as wasps from '../src/sim/scenarios/wasps.js';
import * as termites from '../src/sim/scenarios/termites.js';

const SCENARIOS = { ants, honeybees, wasps, termites };

test('every constant in every colony carries a source', () => {
  for (const [name, mod] of Object.entries(SCENARIOS)) {
    assert.ok(mod.PARAMS, `${name} has no PARAMS table`);
    for (const [key, param] of Object.entries(mod.PARAMS)) {
      assert.ok(param.source && param.source.trim().length > 10,
        `${name}.PARAMS.${key} has no meaningful source — a constant without a citation is a bug`);
      assert.equal(typeof param.value, 'number', `${name}.PARAMS.${key}.value must be a number`);
      assert.ok('unit' in param, `${name}.PARAMS.${key} has no unit`);
    }
  }
});

test('numbers that are inventions are labelled as inventions', () => {
  // The rule is not "no tuned values" — it is that you can always tell which is which.
  let tuned = 0;
  let sourced = 0;
  for (const mod of Object.values(SCENARIOS)) {
    for (const param of Object.values(mod.PARAMS)) {
      if (/^\s*tuned\b/i.test(param.source)) tuned++;
      else sourced++;
    }
  }
  assert.ok(sourced > tuned * 2,
    `most parameters should trace to a measurement: ${sourced} sourced against ${tuned} tuned`);
});

test('every science note cites something', () => {
  for (const [name, mod] of Object.entries(SCENARIOS)) {
    assert.ok(mod.NOTES.length >= 4, `${name} needs more science notes`);
    for (const note of mod.NOTES) {
      assert.ok(note.text && note.text.length > 40, `${name} has a threadbare note`);
      assert.ok(note.source && note.source.length > 5, `${name} has a note with no source`);
    }
  }
});

test('each colony is described as using a different mechanism', () => {
  // The whole project rests on the four being genuinely different. If two blurbs ever converge,
  // something has been copied that should not have been.
  const blurbs = Object.values(SCENARIOS).map((m) => m.meta.blurb);
  assert.equal(new Set(blurbs).size, blurbs.length, 'two colonies share a description');

  const species = Object.values(SCENARIOS).map((m) => m.meta.species);
  assert.equal(new Set(species).size, species.length);
});

test('SCIENCE.md is generated and up to date', () => {
  // Regenerating is one command; letting the published figures drift from the running model is the
  // one thing this document must never do.
  execFileSync('node', ['tools/build-science.js', '--check'], { stdio: 'pipe' });

  const doc = readFileSync('SCIENCE.md', 'utf8');
  for (const mod of Object.values(SCENARIOS)) {
    assert.ok(doc.includes(mod.meta.species), `SCIENCE.md is missing ${mod.meta.species}`);
  }
  assert.ok(doc.includes('tuned'), 'SCIENCE.md must flag its tuned values');
  assert.ok(doc.includes('Time is compressed'), 'SCIENCE.md must own up to the time compression');
});

test('the termite uncertainty survives regeneration', () => {
  const doc = readFileSync('SCIENCE.md', 'utf8');
  assert.ok(doc.toLowerCase().includes('never chemically identified')
    || doc.toLowerCase().includes('never been chemically identified'),
  'the cement pheromone caveat must appear in the generated document');
});
