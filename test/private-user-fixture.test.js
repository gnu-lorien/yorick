/**
 * The `sampprivate` seed fixture, exercised without a database.
 *
 * This fixture is the only oracle the `enforcePrivateUsers` work has, so its
 * shape needs pinning. The thing being protected is narrow and easy to undo by
 * accident: the account must be written with NO `'*'` entry in either `_rperm`
 * or `_acl`. Restore a public-read entry and the fixture still seeds, still
 * logs in, and still looks fine -- it just silently stops reproducing the bug,
 * and every test that depends on it starts passing for the wrong reason.
 *
 * `seedTestUsers` takes a driver handle rather than a URI, so a capturing fake
 * is enough; no mongod, no network. Same approach as
 * test/trigger-compat.test.js's fake Parse.Cloud.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const seed = require('../seed_db');

/** A `db` that records what would have been written. */
function fakeDb() {
    const writes = [];
    return {
        writes: writes,
        collection(name) {
            return {
                async updateOne(filter, update, options) {
                    writes.push({ collection: name, filter, update, options });
                }
            };
        }
    };
}

function userWrite(writes, username) {
    return writes.find(w => w.collection === '_User' && w.filter.username === username);
}

test('the private account is written with no public read', async () => {
    const db = fakeDb();
    await seed.seedTestUsers(db);

    const w = userWrite(db.writes, 'sampprivate');
    assert.ok(w, 'sampprivate was not seeded at all');

    const set = w.update.$set;
    assert.ok(!set._rperm.includes('*'), '_rperm must not grant public read');
    assert.ok(!Object.prototype.hasOwnProperty.call(set._acl, '*'),
        '_acl must not carry a "*" entry');

    // It still has to be readable and writable by itself, which is what
    // RestWrite does for a real signup under the option.
    assert.deepStrictEqual(set._rperm, ['user_sampprivate']);
    assert.deepStrictEqual(set._acl['user_sampprivate'], { w: true, r: true });
});

test('the four original accounts keep public read', async () => {
    // Guards against "fixing" the branch by making every account private, which
    // would change the meaning of every existing spec rather than adding a case.
    const db = fakeDb();
    await seed.seedTestUsers(db);

    for (const name of ['devuser', 'sampmem', 'sampast', 'sampstranger']) {
        const set = userWrite(db.writes, name).update.$set;
        assert.ok(set._rperm.includes('*'), name + ' lost public read');
        assert.deepStrictEqual(set._acl['*'], { r: true }, name + ' lost its "*" ACL entry');
    }
});

test('only the private account carries realname and email', async () => {
    // Without these two fields nothing could tell "withheld" from "never set",
    // because the other four accounts have neither.
    const db = fakeDb();
    await seed.seedTestUsers(db);

    const priv = userWrite(db.writes, 'sampprivate').update.$set;
    assert.strictEqual(typeof priv.realname, 'string');
    assert.strictEqual(typeof priv.email, 'string');

    for (const name of ['devuser', 'sampmem', 'sampast', 'sampstranger']) {
        const set = userWrite(db.writes, name).update.$set;
        assert.strictEqual(set.realname, undefined, name + ' should have no realname');
        assert.strictEqual(set.email, undefined, name + ' should have no email');
    }
});

test('the fixture character points at the private account and joins the troupe', async () => {
    const db = fakeDb();
    await seed.seedPrivateFixtureCharacter(db);

    const row = db.writes.find(w => w.collection === 'Vampire');
    assert.ok(row, 'no Vampire row written');
    // Parse stores a pointer as `_p_<field>`; get this wrong and the character
    // has no owner at all, which is a different bug that looks like this one.
    assert.strictEqual(row.update.$set._p_owner, '_User$user_sampprivate');
    assert.ok(!row.update.$set._rperm.includes('*'), 'the character must not be public');

    // `troupes` is a relation, so troupe membership is a join row. Without it
    // the character is in no troupe and never appears in the roster query it
    // exists to be dropped from.
    const join = db.writes.find(w => w.collection === '_Join:troupes:Vampire');
    assert.ok(join, 'no troupe join row written');
    assert.strictEqual(join.update.$set.owningId, seed.PRIVATE_FIXTURE_CHARACTER_ID);
    assert.strictEqual(join.update.$set.relatedId, seed.SAMPLE_TROUPE_ID);
});
