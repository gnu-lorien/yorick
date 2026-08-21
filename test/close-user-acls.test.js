/**
 * The ACL backfill's decision, exercised without a database.
 *
 * `close_user_acls.js` is the only irreversible step in the S11 work, and its
 * dangerous failure is silent: a row rewritten WITHOUT its own objectId in
 * `_rperm` cannot be read by its owner, and login does not fail on that -- it
 * falls through to an objectId-only user and attaches the session token anyway.
 * The account logs in with no attributes, every gate closed, and nothing in the
 * server log. It would do that to every account at once.
 *
 * So the property worth pinning is narrow and absolute: whatever else `closed`
 * does, the row keeps its own id. The script asserts this again at write time;
 * this is the same guarantee stated where a change to the logic will trip it.
 *
 * Run: npm run test:node
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isPublic, closed } = require('../close_user_acls');

const legacyRow = () => ({
    _id: 'legacyUser1',
    _rperm: ['*', 'legacyUser1'],
    _wperm: ['legacyUser1'],
    _acl: { '*': { r: true }, 'legacyUser1': { r: true, w: true } }
});

test('a legacy row is recognised as public', () => {
    assert.strictEqual(isPublic(legacyRow()), true);
    // Either channel alone is enough -- they are written together but a
    // hand-edited row may carry only one.
    assert.strictEqual(isPublic({ _id: 'x', _rperm: ['*'], _acl: {} }), true);
    assert.strictEqual(isPublic({ _id: 'x', _rperm: [], _acl: { '*': { r: true } } }), true);
});

test('an already-private row is left alone', () => {
    // Idempotence: the script must be safe to re-run after a partial failure.
    const priv = { _id: 'u1', _rperm: ['u1'], _wperm: ['u1'], _acl: { u1: { r: true, w: true } } };
    assert.strictEqual(isPublic(priv), false);
});

test('closing removes public read from BOTH channels', () => {
    const next = closed(legacyRow());
    assert.ok(!next._rperm.includes('*'), '_rperm still grants public read');
    assert.ok(!Object.prototype.hasOwnProperty.call(next._acl, '*'), '_acl still has a "*" entry');
});

test('the row ALWAYS keeps its own id -- the silent-login guard', () => {
    // The one property that must never regress. See this file's header.
    for (const row of [
        legacyRow(),
        { _id: 'u2', _rperm: ['*'], _wperm: ['u2'], _acl: { '*': { r: true } } },
        { _id: 'u3', _rperm: ['*'], _wperm: [], _acl: { '*': { r: true } } },
        { _id: 'u4', _rperm: ['*', 'role:Administrator'], _wperm: ['u4'], _acl: { '*': { r: true }, 'role:Administrator': { r: true } } }
    ]) {
        const next = closed(row);
        assert.ok(next._rperm.includes(row._id),
            row._id + ' lost its own id from _rperm');
        assert.strictEqual(next._acl[row._id].r, true,
            row._id + ' lost its own read grant in _acl');
    }
});

test('other existing grants are preserved, not redesigned', () => {
    // This closes `*`. It is not an opportunity to restructure permissions.
    const row = {
        _id: 'u5',
        _rperm: ['*', 'role:Administrator', 'someOtherUser'],
        _wperm: ['u5'],
        _acl: { '*': { r: true }, 'role:Administrator': { r: true }, 'someOtherUser': { r: true } }
    };
    const next = closed(row);
    assert.ok(next._rperm.includes('role:Administrator'));
    assert.ok(next._rperm.includes('someOtherUser'));
    assert.deepStrictEqual(next._acl['role:Administrator'], { r: true });
});

test('write access is not invented', () => {
    // A row whose owner could not write it before does not gain write here.
    const row = { _id: 'u6', _rperm: ['*'], _wperm: [], _acl: { '*': { r: true } } };
    const next = closed(row);
    assert.strictEqual(next._acl['u6'].w, undefined, 'write was granted that did not exist');
});

test('write access that DID exist survives', () => {
    const next = closed(legacyRow());
    assert.strictEqual(next._acl['legacyUser1'].w, true);
});

test('closing twice is the same as closing once', () => {
    const once = closed(legacyRow());
    const twice = closed({ _id: 'legacyUser1', _rperm: once._rperm, _wperm: ['legacyUser1'], _acl: once._acl });
    assert.deepStrictEqual(twice, once);
});
