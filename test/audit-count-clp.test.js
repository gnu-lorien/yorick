/**
 * The `count` half of audit_db_permissions.js, exercised without a database.
 *
 * auditDatabase() opens a real MongoClient, so the decision it makes per class
 * is factored into classifyCountRule() and tested here instead. What is being
 * pinned is a distinction parse-server itself cannot make: the effective
 * permissions are `{...emptyCLPS, ...storedClassPermissions}` and emptyCLPS
 * supplies `count: {}`, so an ABSENT count key, a stored `{}` and a stored
 * `null` all arrive at validatePermission as one rule that matches nobody.
 * Grading any of them as merely "different from find" would exit 0 on a
 * database whose administration surface is down, which is the outage this
 * check exists to catch.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { classifyCountRule, samePermissionRule } = require('../audit_db_permissions');

function doc(classPermissions) {
    if (classPermissions === undefined) return { _id: 'SomeClass' };
    return { _id: 'SomeClass', _metadata: { class_permissions: classPermissions } };
}

test('a class with no class_permissions is out of scope', () => {
    // No stored object means parse-server never reaches the emptyCLPS merge:
    // the class stays on defaultCLPS, which grants count to everyone. Writing
    // a stored count onto one would replace a working default with a rule that
    // then has to be maintained.
    assert.strictEqual(classifyCountRule(doc(undefined)), null);
    assert.strictEqual(classifyCountRule({ _id: 'X', _metadata: {} }), null);
});

test('an absent count key beside a granting find is a denial', () => {
    const r = classifyCountRule(doc({ find: { '*': true } }));
    assert.strictEqual(r.denied, true);
    assert.strictEqual(r.hasCount, false);
    assert.strictEqual(r.mirrors, false);
});

test('a stored empty count is the same denial as an absent one', () => {
    // The case a hasOwnProperty check would miss.
    const r = classifyCountRule(doc({ find: { '*': true }, count: {} }));
    assert.strictEqual(r.denied, true);
    assert.strictEqual(r.hasCount, true);
});

test('a stored null count is the same denial as an absent one', () => {
    const r = classifyCountRule(doc({ find: { '*': true }, count: null }));
    assert.strictEqual(r.denied, true);
});

test('count mirroring find is healthy', () => {
    const r = classifyCountRule(doc({ find: { '*': true }, count: { '*': true } }));
    assert.strictEqual(r.denied, false);
    assert.strictEqual(r.mirrors, true);
});

test('a narrower count than find is a decision, not the defect', () => {
    // Somebody chose this; --fix must not widen it back to find.
    const r = classifyCountRule(doc({
        find: { '*': true },
        count: { 'role:Administrator': true }
    }));
    assert.strictEqual(r.denied, false);
    assert.strictEqual(r.mirrors, false);
});

test('an empty find has nothing to mirror, so an empty count is not a denial', () => {
    // Refusing find and refusing count is consistent, not an outage.
    const r = classifyCountRule(doc({ create: { '*': true } }));
    assert.strictEqual(r.denied, false);
});

test('the repair mirrors the class own find, not a shared table', () => {
    // Production find rules have drifted from the seed's, so the repair value
    // has to come from the document in hand.
    const r = classifyCountRule(doc({ find: { 'role:Administrator': true } }));
    assert.deepStrictEqual(r.find, { 'role:Administrator': true });
    assert.strictEqual(r.denied, true);
});

test('rules are compared by meaning, so key order is not drift', () => {
    // Without this, --fix would rewrite an already-correct rule on every run.
    assert.strictEqual(samePermissionRule({ a: true, b: true }, { b: true, a: true }), true);
    assert.strictEqual(samePermissionRule({ a: true }, { a: true, b: true }), false);
    assert.strictEqual(samePermissionRule({ a: true }, { a: false }), false);
    assert.strictEqual(samePermissionRule(undefined, {}), true);
});
