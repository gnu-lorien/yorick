/**
 * Contract tests for the history page's replay.
 *
 * `public/scripts/app/react/transform.js` is the one piece of the React port
 * that is not layout: it reconstructs a past version of a character by undoing
 * changes, and the whole page is wrong if it is wrong. Behaviour is taken from
 * `Character.get_transformed`, which is what the Marionette page uses, so these
 * are the rules both implementations have to agree on.
 *
 * They run against the module as it ships - AMD wrapper, real lodash 3.10, no
 * Parse - because the point of converting to plain snapshots at the boundary
 * (see react/snapshot.js) is precisely that the interesting logic no longer
 * needs a browser or a backend to exercise.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const _ = require('../public/scripts/lib/lodash.js');

/**
 * Load one of the react/ AMD modules by running its define() call with a
 * resolver for its dependencies. Cheaper and more honest than converting the
 * module to CommonJS for the sake of the test: what is tested is what ships.
 */
function loadAmd(relativePath, deps) {
  const file = path.join(__dirname, '..', 'public', 'scripts', 'app', relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let exported;
  function define(dependencies, factory) {
    exported = factory.apply(null, dependencies.map((name) => {
      if (!(name in deps)) {
        throw new Error(`${relativePath} asked for an unstubbed dependency: ${name}`);
      }
      return deps[name];
    }));
  }
  // runInThisContext, not runInNewContext: a fresh context has its own Array
  // and Object prototypes, so every array the module returns would fail
  // deepStrictEqual against one built here even when the contents match.
  const wrapped = vm.runInThisContext(
    `(function (define, console) {
${source}
})`, { filename: file });
  wrapped(define, console);
  return exported;
}

const Transform = loadAmd('react/transform.js', { underscore: _ });

/** A change row as snapshot.change() produces one. */
function change(attrs) {
  return Object.assign({
    key: attrs.name + '-' + attrs.type,
    id: attrs.name + '-' + attrs.type,
    createdAt: new Date(0)
  }, attrs);
}

/** A character snapshot with one trait category and one text attribute. */
function character(traits, text) {
  return {
    id: 'c1',
    type: 'Vampire',
    text: Object.assign({ name: 'Test' }, text),
    traits: Object.assign({ skills: [] }, traits),
    extended_print_text: '',
    description: []
  };
}

function trait(name, value) {
  return { key: name, name, value, free_value: 0, cost: 0, category: 'skills' };
}

test('undoing an update restores the recorded old value', () => {
  const before = character({ skills: [trait('Athletics', 5)] });
  const after = Transform.replay(before, [
    change({ category: 'skills', name: 'Athletics', type: 'update', old_value: 3, value: 5 })
  ]);

  assert.deepStrictEqual(after.traits.skills.map((t) => [t.name, t.value]), [['Athletics', 3]]);
  assert.strictEqual(after.description[0].type, 'changed');
  // The input is untouched: replay returns a new snapshot rather than mutating
  // a clone, which is what lets React memoise on it.
  assert.strictEqual(before.traits.skills[0].value, 5);
});

test('an old value of 0 is replayed as 0, not as the new value', () => {
  // Character.get_transformed spells this `change.get("old_value") ||
  // change.get("value")`, so a change away from zero replays the *new* value
  // and the reconstructed character never shows the zero. See transform.js.
  const before = character({ skills: [trait('Athletics', 3)] });
  const after = Transform.replay(before, [
    change({ category: 'skills', name: 'Athletics', type: 'update', old_value: 0, value: 3 })
  ]);

  assert.strictEqual(after.traits.skills[0].value, 0);
});

test('undoing a define removes the trait the change created', () => {
  const before = character({ skills: [trait('Athletics', 3), trait('Brawl', 2)] });
  const after = Transform.replay(before, [
    change({ category: 'skills', name: 'Athletics', type: 'define', value: 3 })
  ]);

  assert.deepStrictEqual(after.traits.skills.map((t) => t.name), ['Brawl']);
  assert.strictEqual(after.description[0].type, 'define');
});

test('undoing a remove puts the deleted trait back', () => {
  const before = character({ skills: [trait('Brawl', 2)] });
  const after = Transform.replay(before, [
    change({ category: 'skills', name: 'Athletics', type: 'remove', old_value: 4, value: 4 })
  ]);

  assert.deepStrictEqual(
    after.traits.skills.map((t) => [t.name, t.value]).sort(),
    [['Athletics', 4], ['Brawl', 2]]);
  assert.strictEqual(after.description[0].type, 'removed');
});

test('undoing an update for a trait that is no longer there does not add undefined', () => {
  // `_.xor(list, [current, fake])` in the original appends `undefined` when
  // `current` is undefined, and the next render walks into it - which is what
  // Character.get_transformed's "Something went wrong fetching the full
  // character object" log is reporting.
  const before = character({ skills: [] });
  const after = Transform.replay(before, [
    change({ category: 'skills', name: 'Athletics', type: 'update', old_value: 3, value: 5 })
  ]);

  assert.strictEqual(after.traits.skills.length, 1);
  assert.ok(after.traits.skills.every((t) => t && t.name === 'Athletics'));
});

test('core_update restores the old text and core_define clears it', () => {
  const before = character({}, { title: 'Seneschal', clan: 'Ventrue' });
  const after = Transform.replay(before, [
    change({ category: 'core', name: 'title', type: 'core_update', old_text: 'Primogen' }),
    change({ category: 'core', name: 'clan', type: 'core_define', new_text: 'Ventrue' })
  ]);

  assert.strictEqual(after.text.title, 'Primogen');
  assert.strictEqual(after.text.clan, undefined);
});

test('experience rows are not replayed onto the character', () => {
  const before = character({ skills: [trait('Athletics', 3)] });
  const after = Transform.replay(before, [
    change({ category: 'experience', name: 'Session award', type: 'define', value: 6 })
  ]);

  assert.deepStrictEqual(after.traits, before.traits);
  assert.deepStrictEqual(after.description, []);
});

test('at() undoes everything after the picked index and nothing at or before it', () => {
  const changes = [
    change({ category: 'skills', name: 'Athletics', type: 'define', value: 3 }),
    change({ category: 'skills', name: 'Brawl', type: 'define', value: 2 }),
    change({ category: 'skills', name: 'Athletics', type: 'update', old_value: 3, value: 5 })
  ];
  const now = character({ skills: [trait('Athletics', 5), trait('Brawl', 2)] });

  // Newest: nothing undone.
  assert.deepStrictEqual(
    Transform.at(now, changes, 2).traits.skills.map((t) => [t.name, t.value]),
    [['Athletics', 5], ['Brawl', 2]]);

  // One back: the update is undone, the two defines are not.
  assert.deepStrictEqual(
    Transform.at(now, changes, 1).traits.skills.map((t) => [t.name, t.value]),
    [['Athletics', 3], ['Brawl', 2]]);

  // Two back: Brawl's define is undone as well.
  assert.deepStrictEqual(
    Transform.at(now, changes, 0).traits.skills.map((t) => [t.name, t.value]),
    [['Athletics', 3]]);
});

test('highlighted() describes the change AT the index, not the ones undone to reach it', () => {
  const changes = [
    change({ category: 'skills', name: 'Athletics', type: 'define', value: 3 }),
    change({ category: 'skills', name: 'Athletics', type: 'update', old_value: 3, value: 5 }),
    change({ category: 'skills', name: 'Brawl', type: 'define', value: 2 })
  ];
  const now = character({ skills: [trait('Athletics', 5), trait('Brawl', 2)] });

  const result = Transform.highlighted(now, changes, 1);

  // The sheet shows the state after change 1 - Athletics at 5, no Brawl yet...
  assert.deepStrictEqual(result.traits.skills.map((t) => [t.name, t.value]), [['Athletics', 5]]);
  // ...and the description carries the value it had *before* that change, so
  // the sheet renders "-3 +5" rather than diffing 5 against itself.
  assert.strictEqual(result.description.length, 1);
  assert.strictEqual(result.description[0].name, 'Athletics');
  assert.strictEqual(result.description[0].fake.value, 3);
});

test('highlighted() puts a deleted trait back so the sheet can strike it through', () => {
  const changes = [
    change({ category: 'skills', name: 'Brawl', type: 'define', value: 2 }),
    change({ category: 'skills', name: 'Athletics', type: 'remove', old_value: 4, value: 4 })
  ];
  const now = character({ skills: [trait('Brawl', 2)] });

  const result = Transform.highlighted(now, changes, 1);
  const athletics = result.traits.skills.find((t) => t.name === 'Athletics');

  assert.ok(athletics, 'the removed trait is put back for rendering');
  assert.strictEqual(athletics.is_deleted, true);
});
