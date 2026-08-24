/**
 * Proof that the React router matches Backbone's URL handling exactly.
 *
 * Run: npm run verify:routes   (needs node >= 22.13 for TypeScript stripping)
 *
 * Compiles every pattern in the legacy route table with both Backbone 1.1.2's
 * own _routeToRegExp -- lifted out of the vendored file at runtime, so this
 * tests against the real implementation rather than a second transcription --
 * and the port in web/src/router/backboneRoutes.ts, then compares the regex
 * sources. Also compares extracted parameters on fragments that exercise the
 * awkward cases: the literal-'?' routes, the seven-segment trait route, and
 * the empty route.
 *
 * If this fails, some URL that used to work no longer does, and the failure
 * names the pattern.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { routeToRegExp, extractParameters } from '../src/router/backboneRoutes.ts';

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
// with a leading slash, which fs then resolves against the drive root.
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const src = fs.readFileSync(REPO + 'public/scripts/lib/backbone.js', 'utf8');

// Lift Backbone's own regex literals and _routeToRegExp straight out of the
// vendored file, so this compares the port against the real implementation
// rather than against a second transcription of it.
const reBlock = src.match(/var optionalParam[\s\S]*?var escapeRegExp\s*=\s*[^;]+;/);
const fnBlock = src.match(/_routeToRegExp: function\(route\) \{[\s\S]*?\n    \},/);
if (!reBlock || !fnBlock) { console.error('could not lift Backbone source'); process.exit(1); }
const body = fnBlock[0].replace('_routeToRegExp: function(route)', 'function(route)').replace(/,\s*$/, '');
const backboneRouteToRegExp = new Function(reBlock[0] + '\nreturn (' + body + ');')();

const extractBlock = src.match(/_extractParameters: function\(route, fragment\) \{[\s\S]*?\n    \}/);
// _extractParameters is written against underscore's _.map; the app vendors
// lodash under that name (see requirejs paths: underscore -> lodash).
const _ = (await import('lodash')).default;
const backboneExtract = new Function('_',
  'return (' + extractBlock[0].replace('_extractParameters: function(route, fragment)', 'function(route, fragment)') + ');'
)(_);

// Every route pattern from the live router.
const routerSrc = fs.readFileSync(REPO + 'public/scripts/app/routers/mobileRouter.js', 'utf8');
const routesBlock = routerSrc.match(/routes:\s*\{[\s\S]*?\n        \}/)[0];
const patterns = [...routesBlock.matchAll(/^\s*"([^"]*)"\s*:\s*"[^"]+"/gm)].map((m) => m[1]);

let mismatches = 0;
for (const p of patterns) {
  const a = backboneRouteToRegExp(p).source;
  const b = routeToRegExp(p).source;
  if (a !== b) {
    console.log('REGEX MISMATCH', JSON.stringify(p));
    console.log('  backbone:', a);
    console.log('  port    :', b);
    mismatches++;
  }
}

// Also check parameter extraction on real fragments, since that is where the
// literal-"?" routes behave unusually.
const samples = [
  ['characters?:type', 'characters?all'],
  ['category?:type', 'category?disciplines'],
  ['victims?:type', 'victims?all'],
  ['character?:id', 'character?abc123'],
  ['character/:cid/log/:start/:changeBy', 'character/abc/log/0/10'],
  ['simpletrait/spacer/:category/:cid/:name/:value/:free_value/new',
   'simpletrait/spacer/merits/abc/Iron%20Will/3/0/new'],
  ['troupe/:id/characters/:type', 'troupe/t1/characters/all'],
  ['administration/patronages/new/:userid', 'administration/patronages/new/u9'],
  ['', ''],
  ['referendum/:id', 'referendum/r1'],
];
for (const [pattern, fragment] of samples) {
  const re = backboneRouteToRegExp(pattern);
  const a = JSON.stringify(backboneExtract(re, fragment));
  const b = JSON.stringify(extractParameters(routeToRegExp(pattern), fragment));
  if (a !== b) {
    console.log('PARAMS MISMATCH', pattern, '<-', fragment, '\n  backbone:', a, '\n  port    :', b);
    mismatches++;
  }
}

console.log(`routes compared: ${patterns.length}, param samples: ${samples.length}, mismatches: ${mismatches}`);
process.exit(mismatches ? 1 : 0);
