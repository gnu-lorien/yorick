/**
 * Regression tests for the defects catalogued in
 * `docs/legacy-bugs-found-during-react-port.md`.
 *
 * The ones covered here are the ones that can be decided without a browser or
 * a Parse server: collection ordering, a query's page size, and the derivation
 * behind the start page's troupe shortcuts. Everything that needs a rendered
 * page - the character sheet's identity block, the admin redirect loop, the
 * troupe failure banner - is in `e2e/legacy-bug-regressions.spec.js` instead.
 *
 * The modules under test are the real ones, loaded through `test/helpers/amd.js`
 * with stubbed dependencies. Nothing here re-implements the code it checks.
 *
 * Run: npm run test:node
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Backbone 1.1.2 and the app's own modules both find lodash on the global.
global._ = require('../public/scripts/lib/lodash.js');
const Backbone = require('../public/scripts/lib/backbone.js');
const CompatPromise = require('../public/scripts/lib/parse-compat/promise');
const makeParseCollection = require('../public/scripts/lib/parse-compat/collection');

const { loadAppModule, loadTemplate, readPublicFile } = require('./helpers/amd');

const _ = global._;

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

/** parse-server's own default page size, which is what the bug ran into. */
const SERVER_DEFAULT_PAGE = 100;

/**
 * A Parse namespace with just enough in it for a collection to exist and fetch.
 *
 * `Parse.Query` records every constraint it is given AND honours the page size,
 * capping at parse-server's default of 100 when nothing asked for more. Without
 * that cap a query with no `limit` would look identical to one with a limit of
 * a thousand, and the clan-rule test below would pass against the very bug it
 * exists to catch.
 */
function stubParse(results) {
  const queries = [];

  function Query(model) {
    this.model = model;
    this.constraints = { limit: null, find: 0 };
    queries.push(this);
  }
  Query.prototype.limit = function (n) {
    this.constraints.limit = n;
    return this;
  };
  Query.prototype.find = function () {
    this.constraints.find++;
    const page = this.constraints.limit || SERVER_DEFAULT_PAGE;
    return Promise.resolve((results || []).slice(0, page));
  };
  Query.prototype.equalTo = function () { return this; };

  const Parse = {
    Query: Query,
    Object: Backbone.Model,
    Promise: CompatPromise
  };
  Parse.Collection = makeParseCollection(Parse);
  return { Parse, queries };
}

/** A stand-in for a Parse.Object as the compat layer presents one. */
function record(attrs) {
  return new Backbone.Model(attrs);
}

// ---------------------------------------------------------------------------
// #2 -- `sortbycreated` has never worked
// ---------------------------------------------------------------------------
//
// The flag was set on the plain ARRAY handed to `reset()` and read off the
// COLLECTION by the comparator. `reset` copies an array's elements, not its
// properties, so the creation-ordered branch could never run and every listing
// has always sorted by name. Three collections carried an identical copy of it.
//
// The branch is deleted rather than repaired. These tests pin the surviving
// order and, more importantly, pin that a `sortbycreated` property arriving by
// the old route changes nothing - which is what someone re-adding the feature
// by that route would have to notice.

test('#2 Vampires sorts by name, and a sortbycreated flag on the reset array changes nothing', () => {
  const { Parse } = stubParse();
  const Vampires = loadAppModule('collections/Vampires.js', {
    jquery: {}, underscore: _, parse: Parse, '../models/Vampire': Backbone.Model
  }).exports;

  const rows = [
    record({ id: 'c', name: 'Corwin' }),
    record({ id: 'a', name: 'Aldous' }),
    record({ id: 'b', name: 'Brenna' })
  ];
  // Exactly what mobileRouter's get_user_characters used to do.
  rows.sortbycreated = true;

  const c = new Vampires();
  c.reset(rows);

  assert.deepStrictEqual(c.map((m) => m.get('name')), ['Aldous', 'Brenna', 'Corwin']);
  assert.strictEqual(c.sortbycreated, undefined,
    'reset() copies elements, not array properties - this is why the branch was dead');
});

test('#2 Users sorts by paidOn', () => {
  const { Parse } = stubParse();
  const Users = loadAppModule('collections/Users.js', {
    jquery: {}, underscore: _, parse: Parse, backbone: Backbone
  }).exports;

  const c = new Users();
  c.reset([
    record({ id: '3', paidOn: '2026-03-01' }),
    record({ id: '1', paidOn: '2026-01-01' }),
    record({ id: '2', paidOn: '2026-02-01' })
  ]);
  assert.deepStrictEqual(c.map((m) => m.get('paidOn')),
    ['2026-01-01', '2026-02-01', '2026-03-01']);
});

test('#2 Patronages sorts by expiresOn, newest expiry first', () => {
  const { Parse } = stubParse();
  const Patronages = loadAppModule('collections/Patronages.js', {
    jquery: {}, underscore: _, parse: Parse, backbone: Backbone,
    '../models/Patronage': Backbone.Model
  }).exports;

  const c = new Patronages();
  c.reset([
    record({ id: '1', expiresOn: '2026-01-01' }),
    record({ id: '3', expiresOn: '2026-03-01' }),
    record({ id: '2', expiresOn: '2026-02-01' })
  ]);
  assert.deepStrictEqual(c.map((m) => m.get('expiresOn')),
    ['2026-03-01', '2026-02-01', '2026-01-01']);
});

test('#2 no copy of the dead sortbycreated branch is left in the source', () => {
  const files = [
    'scripts/app/collections/Vampires.js',
    'scripts/app/collections/Users.js',
    'scripts/app/collections/Patronages.js',
    'scripts/app/routers/mobileRouter.js'
  ];
  files.forEach((f) => {
    const src = readPublicFile(f);
    assert.ok(!/\bsortbycreated\b/.test(src.replace(/\/\/.*$/gm, '')),
      f + ' still references sortbycreated outside a comment');
  });
});

// ---------------------------------------------------------------------------
// #12 -- the clan-rule fetch took the server's default page of 100
// ---------------------------------------------------------------------------
//
// With no `query` on the collection, `Parse.Collection.prototype.fetch` builds
// a bare query and `find()` caps at 100 rows. There are 42 clan rules on the
// running server, so nothing was lost yet - but past 100 a clan's rule would
// silently vanish, `get_in_clan_disciplines` would return [] for it, and its
// disciplines would be priced at the out-of-clan rate. That surfaces as
// characters being over-charged experience, never as an error.

test('#12 the clan rule fetch asks for far more than the default page of 100', async () => {
  const { Parse, queries } = stubParse([]);
  const ClanRules = loadAppModule('collections/BNSMETV1_ClanRules.js', {
    underscore: _, parse: Parse, '../models/BNSMETV1_ClanRule': Backbone.Model
  }).exports;

  const c = new ClanRules();
  c.fetch();
  await tick();

  assert.strictEqual(queries.length, 1, 'fetch reused the collection query rather than building a bare one');
  assert.ok(queries[0].constraints.limit >= 1000,
    'expected an explicit limit well above 100, got ' + queries[0].constraints.limit);
  assert.strictEqual(queries[0].constraints.find, 1);
});

test('#12 a clan whose rule sits past the 100th row is still found', async () => {
  // The failure this guards is silent: an absent rule reads as "no in-clan
  // disciplines", which is a legal answer, so only the count proves it.
  const rules = _.map(_.range(0, 150), (i) => record({
    id: 'rule' + i,
    clan: 'Clan ' + i,
    discipline_1: 'D' + i + 'a',
    discipline_2: 'D' + i + 'b',
    discipline_3: 'D' + i + 'c'
  }));
  const { Parse } = stubParse(rules);
  const ClanRules = loadAppModule('collections/BNSMETV1_ClanRules.js', {
    underscore: _, parse: Parse, '../models/BNSMETV1_ClanRule': Backbone.Model
  }).exports;

  const c = new ClanRules();
  c.fetch();
  await tick();

  assert.strictEqual(c.length, 150);
  const character = record({ clan: 'Clan 142' });
  assert.deepStrictEqual(c.get_in_clan_disciplines(character),
    ['D142a', 'D142b', 'D142c']);
});

// ---------------------------------------------------------------------------
// #1 -- the start page's troupe shortcuts have been empty since Parse 8
// ---------------------------------------------------------------------------
//
// `role.attributes.attributes.name` was a doubled path that resolved under
// Parse 1.5, where a Parse.Object added to a Backbone collection was wrapped
// and the object itself became the attribute bag. Under parse@8 the compat
// layer teaches Backbone that a Parse.Object IS a model, so the object is
// stored as itself and `.attributes.attributes` is `undefined`. Reading
// `.name` off that threw inside a promise callback, the exception was
// swallowed, `reset` never ran, and the "Troupe View All Characters" section
// rendered its heading above an empty list for every storyteller and admin.

/** Build the real PlayerOptionsView with everything around it stubbed out. */
function loadPlayerOptionsView(roleNames, troupesById) {
  const roles = new Backbone.Collection(
    _.map(roleNames, (n, i) => record({ id: 'role' + i, name: n })));

  const requestedIds = [];
  const TroupeHelper = {
    channel: { reqres: { request: function (verb, id) {
      if ('all' === verb) return new Backbone.Collection();
      requestedIds.push(id);
      return troupesById[id];
    } } }
  };
  const RoleHelper = {
    channel: { reqres: { request: function () { return roles; } } }
  };

  // Marionette's views need a DOM; nothing under test touches one, so stand in
  // with the smallest thing that still runs `initialize` and mixes in the
  // events `listenTo` needs.
  function StubView(options) {
    this.options = options || {};
    this.initialize.apply(this, arguments);
  }
  StubView.prototype.initialize = function () {};
  _.extend(StubView.prototype, Backbone.Events);
  StubView.extend = Backbone.Model.extend;
  const Marionette = { ItemView: StubView, CompositeView: StubView, LayoutView: StubView };

  const { Parse } = stubParse();
  const View = loadAppModule('views/PlayerOptionsView.js', {
    backbone: Backbone,
    marionette: Marionette,
    'text!../templates/player_options.html': loadTemplate('templates/player_options.html'),
    '../helpers/PromiseFailReport': function () {},
    parse: Parse,
    '../helpers/RoleWreqr': RoleHelper,
    '../helpers/TroupeWreqr': TroupeHelper,
    '../collections/Troupes': Backbone.Collection,
    'text!../templates/troupe-list-entry.html': loadTemplate('templates/troupe-list-entry.html')
  }).exports;

  return { View: View, requestedIds: requestedIds };
}

test('#1 a storyteller holding a troupe role gets that troupe in the shortcut list', async () => {
  const troupe = record({ id: 'qvtD2RxzGG', name: 'Sample Troupe' });
  const { View, requestedIds } = loadPlayerOptionsView(
    ['LST_qvtD2RxzGG'], { qvtD2RxzGG: troupe });

  const view = new View();
  view.update_troupes();
  await tick();

  assert.deepStrictEqual(requestedIds, ['qvtD2RxzGG'],
    'the troupe id must come out of role.get("name"), not role.attributes.attributes.name');
  assert.strictEqual(view.troupes.length, 1);
  assert.strictEqual(view.troupes.at(0).get('name'), 'Sample Troupe');
});

test('#1 several troupe roles all resolve, and duplicates of one troupe do not', async () => {
  const one = record({ id: 'AAA', name: 'One' });
  const two = record({ id: 'BBB', name: 'Two' });
  const { View } = loadPlayerOptionsView(
    ['LST_AAA', 'AST_BBB', 'Narrator_AAA'], { AAA: one, BBB: two });

  const view = new View();
  view.update_troupes();
  await tick();

  // `reset` de-duplicates by id, so the two AAA roles contribute one row.
  assert.deepStrictEqual(view.troupes.map((t) => t.get('name')), ['One', 'Two']);
});

test('#1 a global role names no troupe and is skipped without throwing', async () => {
  const troupe = record({ id: 'AAA', name: 'One' });
  const { View, requestedIds } = loadPlayerOptionsView(
    ['Administrator', 'SiteAdministrator', 'LST_AAA'], { AAA: troupe });

  const view = new View();
  view.update_troupes();
  await tick();

  assert.deepStrictEqual(requestedIds, ['AAA'],
    'Administrator has no "_" and names no troupe');
  assert.strictEqual(view.troupes.length, 1);
});

test('#1 a role for a troupe this user cannot see leaves the list empty, not broken', async () => {
  const { View } = loadPlayerOptionsView(['LST_MISSING'], {});
  const view = new View();
  view.update_troupes();
  await tick();
  assert.strictEqual(view.troupes.length, 0);
});

// ---------------------------------------------------------------------------
// #8 -- specializing a trait in a category with no Description row threw
// ---------------------------------------------------------------------------
//
// The collection behind the help text is queried with
// `equalTo("category", category).startsWith("name", base_name)`, so a trait
// whose base name matches no Description row yields an empty collection.
// `first()` is then `undefined` and the template read `.attributes` off it.

function specializationTemplate() {
  const html = readPublicFile('index.html');
  const m = html.match(
    /<script id="simpleTraitSpecialization" type="text\/template">([\s\S]*?)<\/script>/);
  assert.ok(m, 'the simpleTraitSpecialization template is still in index.html');
  return _.template(m[1]);
}

test('#8 the specialization page renders with no matching Description row', () => {
  const render = specializationTemplate();
  const html = render({
    model: record({ name: 'Obscure Thing' }),
    name: 'Obscure Thing',
    specialization: '',
    description: undefined
  });
  assert.ok(html.indexOf('Specialization for Obscure Thing') !== -1);
});

test('#8 a Description row that does exist still supplies its help text', () => {
  const render = specializationTemplate();
  const html = render({
    model: record({ name: 'Lore' }),
    name: 'Lore',
    specialization: 'Vampire',
    description: record({ help_specialization: 'Name the subject you know.' })
  });
  assert.ok(html.indexOf('Name the subject you know.') !== -1);
});

// ---------------------------------------------------------------------------
// #10 -- the troupe staff list printed an email column that was always blank
// ---------------------------------------------------------------------------
//
// `get_troupe_staff` builds each staffer through `identity_of`, and
// `cloud/main.js` sets `IDENTITY_INCLUDES_EMAIL = false` deliberately;
// parse-server also withholds another user's address from every non-master
// read. The column could only ever render as a double space, and the fix must
// not be to publish the addresses.

test('#10 the staff list renders role, username and real name, with no blank gap', () => {
  const render = _.template(loadTemplate('templates/troupe-staff-list.html'));
  const html = render({ collection: [
    record({ role: 'LST', username: 'devuser', realname: 'Dev User' })
  ] });
  const line = html.replace(/\s+/g, ' ').trim();
  assert.ok(line.indexOf('LST: devuser Dev User') !== -1,
    'expected no double space where the email used to be, got: ' + line);
});

test('#10 the staff template does not ask for an email address', () => {
  const src = loadTemplate('templates/troupe-staff-list.html');
  assert.ok(src.indexOf('email') === -1,
    'IDENTITY_INCLUDES_EMAIL is false on purpose - do not publish staff addresses');
});

// ---------------------------------------------------------------------------
// #11 -- the administration menu was a plain bullet list
// ---------------------------------------------------------------------------

test('#11 the administration menu is a jQuery Mobile inset listview', () => {
  const html = readPublicFile('index.html');
  const block = html.match(
    /<div id="administration" data-role="page"[\s\S]*?<\/div>\s*<!-- \/content -->/);
  assert.ok(block, 'the #administration page is still in index.html');
  assert.ok(/<ul[^>]*data-role="listview"/.test(block[0]),
    'without data-role="listview" jQuery Mobile leaves it as bullet-point links');
  assert.ok(/<ul[^>]*data-inset="true"/.test(block[0]),
    '#player-options one click away is inset; this should match');
  assert.ok(block[0].indexOf('>SummarizeCharacters<') === -1,
    'the unspaced label is fixed');
  assert.ok(block[0].indexOf('>Summarize Characters<') !== -1);
});

// ---------------------------------------------------------------------------
// #3 -- a dead "Link Account to Facebook" button still painted
// ---------------------------------------------------------------------------
//
// The click handler called `Parse.FacebookUtils.link`, and `app/loadall.js`
// deliberately no longer calls `Parse.FacebookUtils.init()` - under parse@8
// that throws during bootstrap and takes the whole router down, so every route
// 404s. The button rendered and could not work.

test('#3 nothing in the app renders a Facebook account-linking control any more', () => {
  const profile = loadTemplate('templates/user-settings-profile.html');
  assert.ok(profile.indexOf('facebook') === -1,
    'the profile page still has a Facebook region');

  const view = readPublicFile('scripts/app/views/UserSettingsProfileView.js');
  const code = view.replace(/\/\/.*$/gm, '');
  assert.ok(code.indexOf('FacebookUtils') === -1,
    'FacebookUtils is unreachable under parse@8 - loadall.js never inits it');
  assert.ok(code.indexOf('facebook-account-linking') === -1);
});

test('#3 the orphaned facebook template is gone and nothing still requires it', () => {
  assert.throws(() => loadTemplate('templates/profile-facebook-account.html'),
    /ENOENT/, 'the template should have been deleted with the view');

  ['scripts/app/views/UserSettingsProfileView.js',
   'scripts/app/views/ReferendumView.js'].forEach((f) => {
    assert.ok(readPublicFile(f).indexOf('profile-facebook-account') === -1,
      f + ' still requires a template that no longer exists');
  });
});

// ---------------------------------------------------------------------------
// #5 / #7 / #13 -- shapes in mobileRouter.js that are hard to reach from a
// browser but easy to lose in an edit.
// ---------------------------------------------------------------------------
//
// The behaviour of all three is asserted for real in
// `e2e/legacy-bug-regressions.spec.js`. These are the cheap structural guards
// that fail in a second rather than in a suite run.

test('#5 the admin refusal replaces the history entry instead of pushing one', () => {
  const src = readPublicFile('scripts/app/routers/mobileRouter.js');
  const tail = src.match(/admin_route_failed: function \(context\) \{[\s\S]*?\n        \},/);
  assert.ok(tail, 'admin_route_failed is still in mobileRouter.js');
  const code = tail[0].replace(/\/\/.*$/gm, '');
  assert.ok(code.indexOf('window.location.replace("#")') !== -1,
    'expected location.replace, which overwrites the entry the user came from');
  assert.ok(!/window\.location\.hash\s*=/.test(code),
    'assigning to location.hash pushes, and Back then bounces the user forever');
});

test('#7 the troupe route reports a failure, with .fail before .always', () => {
  const src = readPublicFile('scripts/app/routers/mobileRouter.js');
  const handler = src.match(/\n        troupe: function \(id\) \{[\s\S]*?\n        \},/);
  assert.ok(handler, 'the troupe route handler is still in mobileRouter.js');
  const code = handler[0];
  const failAt = code.indexOf('.fail(ReportError.on(');
  const alwaysAt = code.indexOf('.always(');
  assert.ok(failAt !== -1, 'a troupe that cannot be fetched must say so');
  assert.ok(alwaysAt !== -1, 'the loader must still come down either way');
  assert.ok(failAt < alwaysAt,
    'an always handler that returns a value resolves the chain, so a fail after ' +
    'it never runs - see the note at the tail of helpers/ReportError.js');
});

test('#13 the roster query still does not include("owner")', () => {
  const src = readPublicFile('scripts/app/routers/mobileRouter.js');
  const handler = src.match(/get_user_characters: function \(\) \{[\s\S]*?\n        \},/);
  assert.ok(handler, 'get_user_characters is still in mobileRouter.js');
  const code = handler[0].replace(/\/\/.*$/gm, '');
  assert.ok(code.indexOf('include("owner")') === -1,
    'including the owner makes parse-server DELETE the pointer for a private ' +
    'owner, and get_me_acl then grants the VIEWER read and write - see the ' +
    'note at models/Vampire.js get_character');
});
