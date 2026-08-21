/**
 * The projection that stands between a master-key read and a credential leak.
 *
 * The three S11 Cloud functions read `_User` with `useMasterKey`, and a
 * master-key read bypasses BOTH of parse-server's safety nets: `protectedFields`
 * (computed only for non-master callers) and the `authData` strip
 * (filterSensitiveData returns early for master, before `delete object.authData`
 * runs). helpers/FacebookLogin.js shows `authData` carries a live access token,
 * and an auth user's server data carries the caller's session token.
 *
 * So `identity_of` is not a formatting helper. It is the allowlist, and it is
 * the only mechanical guard here against a future leak. These tests assert a
 * KEY SET rather than values, which is what makes them meaningful despite no
 * seeded account carrying most of these fields.
 *
 * Run: npm run test:node
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Parse = require('parse/node');

// cloud/main.js registers triggers and functions at require time and reads
// `global.Parse` to do it -- parse-server injects that at boot; here the test
// supplies it. Same approach as test/trigger-compat.test.js.
const registered = { define: new Map() };
Parse.Cloud = {
    define: (name, fn) => registered.define.set(name, fn),
    beforeSave: () => {},
    beforeDelete: () => {},
    afterSave: () => {},
    afterDelete: () => {}
};
global.Parse = Parse;

const main = require('../cloud/main.js');

/** A `_User` carrying every dangerous field a real row can carry. */
function poisonedUser() {
    return Parse.Object.fromJSON({
        className: '_User',
        objectId: 'u_poison',
        username: 'sam',
        realname: 'Sam Rutherford',
        email: 'sam@example.invalid',
        massmailauthorization: true,
        acceptedtos: true,
        // None of the following may ever leave the server.
        authData: { facebook: { access_token: 'LIVE-FB-TOKEN', id: '42' } },
        sessionToken: 'r:a-real-session-token',
        password: 'plaintext-somehow',
        _hashed_password: '$2a$10$notarealhash',
        ACL: { 'u_poison': { read: true, write: true } },
        emailVerified: true
    });
}

test('the three functions registered', () => {
    // If a rename silently drops one, every caller degrades to "(unknown)"
    // rather than erroring, so pin the names.
    for (const name of ['list_users', 'get_users_by_id', 'get_troupe_staff']) {
        assert.strictEqual(typeof registered.define.get(name), 'function',
            name + ' was not registered');
    }
});

test('each function takes (request, response)', () => {
    // parse-server's arity-2 arm sends nothing if a body neither settles
    // `response` nor returns a value. Dropping to arity 1 turns every call into
    // a hang rather than an error -- the failure mode cloud/main.js already
    // records hitting once. Cheap assertion, stops a "simplification".
    for (const name of ['list_users', 'get_users_by_id', 'get_troupe_staff']) {
        assert.strictEqual(registered.define.get(name).length, 2,
            name + ' must keep arity 2');
    }
});

test('identity_of returns exactly the allowlisted keys and nothing else', () => {
    const out = main.identity_of(poisonedUser());
    const keys = Object.keys(out.attributes).sort();

    // No `email`. parse-server withholds it from every non-owner read already,
    // so returning it from a master-keyed read would be a new capability rather
    // than a preserved one. Owner decision, 2026-08-20.
    assert.deepStrictEqual(keys,
        ['acceptedtos', 'massmailauthorization', 'realname', 'username']);
});

test('identity_of never carries credentials, tokens or ACLs', () => {
    // Stated separately from the key-set assertion above so a future change to
    // IDENTITY_FIELDS cannot quietly take this guarantee with it.
    const out = main.identity_of(poisonedUser());
    for (const forbidden of ['authData', 'sessionToken', 'password',
                             '_hashed_password', 'ACL', 'emailVerified', 'email']) {
        assert.strictEqual(out.get(forbidden), undefined,
            forbidden + ' escaped through identity_of');
    }
    assert.strictEqual(out.getSessionToken(), undefined,
        'the session token survived as a session token');
});

test('identity_of returns a CLEAN object, or the browser gets blanks', () => {
    // The encoder ships a bare attribute-less Pointer for any dirty object, so
    // a single .set() here would render every name as blank with no error
    // anywhere. This is why `extra` is smuggled into the JSON instead.
    const out = main.identity_of(poisonedUser());
    assert.strictEqual(out.dirty(), false);
    assert.ok(out instanceof Parse.User, 'must decode as a Parse.User');

    const encoded = JSON.parse(JSON.stringify(out.toJSON()));
    assert.strictEqual(encoded.username, 'sam',
        'attributes did not survive encoding -- the object was dirty');
});

test('the per-troupe role label rides along without dirtying the object', () => {
    const out = main.identity_of(poisonedUser(), { role: 'AST' });
    assert.strictEqual(out.get('role'), 'AST');
    assert.strictEqual(out.dirty(), false, 'extra must not dirty the object');
});

test('a missing field is omitted rather than sent as null', () => {
    // Most accounts have no realname. Sending null would make templates print
    // "null" where they currently print nothing.
    const sparse = Parse.Object.fromJSON({
        className: '_User', objectId: 'u_sparse', username: 'plain'
    });
    const out = main.identity_of(sparse);
    assert.deepStrictEqual(Object.keys(out.attributes), ['username']);
});

test('the query projection matches the allowlist', () => {
    // Defence in depth: identity_of filters, and identity_select stops the
    // extra fields being fetched at all. They must not drift apart.
    const selected = main.identity_select().slice().sort();
    const expected = main.IDENTITY_FIELDS
        .concat(main.IDENTITY_INCLUDES_EMAIL ? ['email'] : [])
        .slice().sort();
    assert.deepStrictEqual(selected, expected);
    assert.ok(!selected.includes('authData'));
    assert.ok(!selected.includes('_hashed_password'));
});

test('the batch cap is a real number', () => {
    assert.strictEqual(typeof main.MAX_IDENTITY_IDS, 'number');
    assert.ok(main.MAX_IDENTITY_IDS > 0 && main.MAX_IDENTITY_IDS <= 1000);
});
