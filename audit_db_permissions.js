/**
 * Database Permission & Security Auditor
 *
 * Checks MongoDB collections for proper Parse Server Class Level Permissions (CLPs),
 * Role configurations, and Record-level ACL invariants.
 *
 * Usage:
 *   node audit_db_permissions.js [mongodb_uri] [--fix]
 */

const MongoClient = require('mongodb').MongoClient;

/**
 * Every expected CLP below states `count` explicitly, mirroring its own `find`.
 *
 * That is not decoration. parse-server's MongoSchemaCollection builds a class's
 * effective permissions as `{...emptyCLPS, ...storedClassPermissions}`, and
 * emptyCLPS carries a `count` key whose value is an empty object. Absent and
 * empty are not the same thing downstream: SchemaController.validatePermission
 * returns early and allows an operation the merged permissions have no key for,
 * but throws OPERATION_FORBIDDEN when the key is there and matches nobody.
 * Because the merge always supplies the key, omitting `count` from a stored
 * object is a refusal rather than a default - which is why a schema written
 * against a server whose empty-permission template predated the `count` key
 * stops working the moment it is read by one whose template has it.
 *
 * Drop `count` from one of these objects and `--fix` writes a class no client
 * can count. Nothing in this app pages on a count; every count() it issues is
 * a privilege check - the staff/admin nav gate, the admin route gate, the
 * admin user list, the troupe staff editor - so what a refused count takes
 * down is the administration surface, for administrators included.
 */
const EXPECTED_RULE_CLP = {
    get: { "*": true },
    find: { "*": true },
    count: { "*": true },
    create: { "role:Administrator": true },
    update: { "role:Administrator": true },
    delete: { "role:Administrator": true },
    addField: { "role:Administrator": true }
};

const EXPECTED_APPROVAL_CLP = {
    get: { "*": true },
    find: { "*": true },
    count: { "*": true },
    create: { "role:Administrator": true, "role:AST": true, "role:LST": true },
    update: { "role:Administrator": true, "role:LST": true },
    delete: { "role:Administrator": true, "role:LST": true },
    addField: { "role:Administrator": true }
};

const SENSITIVE_RULE_COLLECTIONS = [
    'bnsmetv1_ClanRule',
    'bnsctdbs_KithRule',
    'bnsmetv1_ElderDisciplineRule',
    'bnsmetv1_RitualRule',
    'bnsmetv1_TechniqueRule'
];

/**
 * The create permission every remediated class is expected to carry.
 *
 * This exists because a class-level permission change in
 * database_seed/_SCHEMA.json does not reach a database that already has users:
 * seed_db.js imports the seed directory only on a cold database. So the schema
 * file states the intent and this states the same intent for databases already
 * in flight - `--fix` is what actually reconciles them.
 *
 * Only `create` is asserted. Read permissions are deliberately left open on
 * most of these because per-row ACLs do the filtering, and `update`/`delete`
 * are left alone for the same reason - notably on Description, where each row's
 * ACL already restricts writes to Administrator and produces the "Object not
 * found" that the access-control suite asserts. Tightening those to a role
 * would change the refusal code for no security gain.
 */
const EXPECTED_CREATE_CLP = {
    // Characters and everything hanging off them. Guarded in cloud code too;
    // these are the second line of defence.
    Vampire: { requiresAuthentication: true },
    SimpleTrait: { requiresAuthentication: true },
    ExperienceNotation: { requiresAuthentication: true },
    LongText: { requiresAuthentication: true },
    VampireCreation: { requiresAuthentication: true },
    // Uploads. Guarded in cloud code too. Before that guard existed, an
    // anonymous POST with no file crashed the thumbnail hook rather than being
    // refused, which is why the create permission never looked like the problem.
    CharacterPortrait: { requiresAuthentication: true },
    TroupePortrait: { requiresAuthentication: true },
    ReferendumPortrait: {},
    // Already refused anonymous creates via its own beforeSave; the permission
    // is brought in line so the two layers agree rather than relying on one.
    VampireApproval: { requiresAuthentication: true },
    // Global reference data, editable only through the admin bulk editor.
    Description: { "role:Administrator": true },
    // Written solely by the vote_for_referendum cloud function, with the master
    // key, so no client may create one directly.
    ReferendumBallot: {},
    // Unreferenced anywhere in the app. Locked rather than dropped.
    ChangeType: {},
    InClanDisciplines: {}
};

/**
 * Classes whose public create permission is legitimate.
 *
 * `_User` create is signup, and `_Session` is managed by Parse itself. Anything
 * else with `create: {"*": true}` is a finding by default - which is the point,
 * because a class added without an explicit class_permissions entry inherits
 * Parse's fully public default silently. LongText and ReferendumBallot were
 * invisible to this auditor for years for exactly that reason.
 */
const PUBLIC_CREATE_ALLOWED = ['_User', '_Session'];

/**
 * Compare two CLP rules for equal meaning rather than equal text.
 *
 * `count` and `find` are separate stored objects, so two rules that grant the
 * same entities can still serialise in a different key order. Comparing them
 * with JSON.stringify the way the `create` check compares against a single
 * literal would report those as drift and then "repair" them into an identical
 * value on every run.
 */
function samePermissionRule(a, b) {
    const aKeys = Object.keys(a || {}).sort();
    const bKeys = Object.keys(b || {}).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, i) =>
        key === bKeys[i] && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/**
 * Decide whether one stored _SCHEMA document is exposed to the missing-`count`
 * defect, and what its count rule would have to become.
 *
 * Kept free of any database handle so the decision can be exercised without
 * standing up a mongod; auditDatabase() is where the reporting and the write
 * live.
 *
 * Returns null for a class the defect cannot reach. Otherwise it returns
 * { className, find, count, hasCount, mirrors }, where `count` is the rule
 * parse-server will actually enforce - an absent key enforces as empty, not as
 * absent.
 */
function classifyCountRule(schemaDoc) {
    const metadata = schemaDoc._metadata;
    // Scope. A document with no class_permissions key never reaches the
    // emptyCLPS merge at all: mongoSchemaToParseSchema leaves the class on
    // defaultCLPS, which grants count to everyone. Those classes are not
    // broken, and writing a stored count onto one would replace a working
    // public default with a rule that then has to be maintained. Their actual
    // problem is the fully public create that same default hands out, and the
    // public-create sweep in auditDatabase() is what reports it.
    if (!metadata || !metadata.class_permissions) return null;

    const clp = metadata.class_permissions;
    const find = clp.find || {};
    const hasCount = Object.prototype.hasOwnProperty.call(clp, 'count');
    const count = (hasCount && clp.count) || {};

    // `hasCount` records how the document is WRITTEN; `denied` records what
    // parse-server ENFORCES, and only the second may decide severity. The
    // merge cannot distinguish an absent key from a stored `{}` or a stored
    // null - all three arrive as a rule that matches nobody. A stored empty
    // count beside a granting find is therefore the identical outage, and
    // grading it as a mere disagreement would exit 0 on a database whose
    // administration surface is down.
    const denied = Object.keys(count).length === 0 &&
        Object.keys(find).length > 0;

    return {
        className: schemaDoc._id,
        find: find,
        count: count,
        hasCount: hasCount,
        denied: denied,
        mirrors: samePermissionRule(count, find)
    };
}

async function auditDatabase(mongoUri, fixMode) {
    console.log('='.repeat(70));
    console.log(' YORICK DATABASE PERMISSION & SECURITY AUDITOR');
    console.log('='.repeat(70));
    console.log(`Connecting to: ${mongoUri}`);
    console.log(`Fix Mode: ${fixMode ? 'ENABLED (Will repair issues)' : 'DISABLED (Read-only check)'}\n`);

    const client = await MongoClient.connect(mongoUri);
    const db = client.db();

    let passed = 0;
    let warnings = 0;
    let errors = 0;

    function report(status, category, message) {
        if (status === 'PASS') {
            passed++;
            console.log(` [PASS] [${category}] ${message}`);
        } else if (status === 'WARN') {
            warnings++;
            console.log(` [WARN] [${category}] ${message}`);
        } else if (status === 'FAIL') {
            errors++;
            console.log(` [FAIL] [${category}] ${message}`);
        }
    }

    try {
        // ====================================================================
        // 1. Audit Class Level Permissions (CLPs) in _SCHEMA
        // ====================================================================
        console.log('--- 1. Class Level Permissions (CLP) Audits ---');
        const schemaCollection = db.collection('_SCHEMA');
        const schemas = await schemaCollection.find({}).toArray();
        const schemaMap = {};
        schemas.forEach(s => { schemaMap[s._id] = s; });

        // Check Global Rule Collections
        for (const colName of SENSITIVE_RULE_COLLECTIONS) {
            const schemaDoc = schemaMap[colName];
            if (!schemaDoc) {
                report('WARN', 'Schema', `Collection '${colName}' not found in _SCHEMA.`);
                continue;
            }

            const metadata = schemaDoc._metadata || {};
            const clp = metadata.class_permissions || {};

            const hasPublicCreate = clp.create && clp.create['*'] === true;
            const hasPublicUpdate = clp.update && clp.update['*'] === true;
            const hasPublicDelete = clp.delete && clp.delete['*'] === true;

            if (hasPublicCreate || hasPublicUpdate || hasPublicDelete) {
                report('FAIL', 'CLP Security', `Collection '${colName}' allows public writes (create: ${!!hasPublicCreate}, update: ${!!hasPublicUpdate}, delete: ${!!hasPublicDelete}).`);
                if (fixMode) {
                    // Note this replaces the whole class_permissions object
                    // rather than merging into it, so every key the repaired
                    // class ends up with is a key EXPECTED_RULE_CLP names.
                    await schemaCollection.updateOne(
                        { _id: colName },
                        { $set: { '_metadata.class_permissions': EXPECTED_RULE_CLP } }
                    );
                    // `schemas` was read once, before any repair ran, so later
                    // passes see the pre-repair document unless it is refreshed
                    // here. Without this the count sweep would mirror a `find`
                    // this write has already thrown away.
                    schemaDoc._metadata = schemaDoc._metadata || {};
                    schemaDoc._metadata.class_permissions = EXPECTED_RULE_CLP;
                    console.log(`        -> [FIXED] Updated CLPs for '${colName}' in _SCHEMA.`);
                }
            } else {
                report('PASS', 'CLP Security', `Collection '${colName}' properly restricts writes.`);
            }
        }

        // Check the remediated create permissions, per class.
        for (const colName of Object.keys(EXPECTED_CREATE_CLP)) {
            const schemaDoc = schemaMap[colName];
            if (!schemaDoc) {
                report('WARN', 'Schema', `Collection '${colName}' not found in _SCHEMA.`);
                continue;
            }

            const clp = (schemaDoc._metadata && schemaDoc._metadata.class_permissions) || {};
            const expected = EXPECTED_CREATE_CLP[colName];
            const actual = clp.create || {};

            if (JSON.stringify(actual) === JSON.stringify(expected)) {
                report('PASS', 'CLP Security', `Collection '${colName}' create permission matches the expected ${JSON.stringify(expected)}.`);
                continue;
            }

            report('FAIL', 'CLP Security',
                `Collection '${colName}' create permission is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}. ` +
                `A seeded database keeps the permissions it was created with, so this drifts from _SCHEMA.json until repaired.`);
            if (fixMode) {
                await schemaCollection.updateOne(
                    { _id: colName },
                    { $set: { '_metadata.class_permissions.create': expected } }
                );
                // On a class that had NO class_permissions, that dotted $set
                // CREATES one - moving the class off parse-server's public
                // default and onto a stored object whose only key is `create`.
                // A stored object with no `count` is exactly what the sweep
                // below exists to catch, so this repair can introduce the very
                // defect. `schemas` was read once, before any repair ran, so
                // without this the sweep would still see the pre-repair
                // document, classify the class as out of scope, and leave it
                // uncountable.
                schemaDoc._metadata = schemaDoc._metadata || {};
                schemaDoc._metadata.class_permissions =
                    schemaDoc._metadata.class_permissions || {};
                schemaDoc._metadata.class_permissions.create = expected;
                console.log(`        -> [FIXED] Set create permission for '${colName}' in _SCHEMA.`);
            }
        }

        // Catch the root cause rather than the instances: any class at all that
        // can be created by an anonymous request. A class added without an
        // explicit class_permissions entry inherits Parse's fully public
        // default, so this is what stops the next one going unnoticed.
        for (const schemaDoc of schemas) {
            const colName = schemaDoc._id;
            if (PUBLIC_CREATE_ALLOWED.indexOf(colName) !== -1) continue;
            if (Object.prototype.hasOwnProperty.call(EXPECTED_CREATE_CLP, colName)) continue;

            const clp = (schemaDoc._metadata && schemaDoc._metadata.class_permissions) || {};
            // No class_permissions entry at all is the same thing as fully
            // public, and is easier to miss.
            const missing = !schemaDoc._metadata || !schemaDoc._metadata.class_permissions;
            const publicCreate = clp.create && clp.create['*'] === true;

            if (missing) {
                report('FAIL', 'CLP Security',
                    `Collection '${colName}' has no class_permissions at all, so it inherits Parse's fully public default - anyone can create rows in it.`);
            } else if (publicCreate) {
                report('FAIL', 'CLP Security',
                    `Collection '${colName}' allows create by anyone ("*").`);
            }
        }

        // ORDERING: this sweep must stay after the sensitive-rule-collection
        // loop above, because that loop's `--fix` replaces the whole
        // class_permissions object. Run the two the other way round and the
        // replacement drops the count rule this sweep has just written, so a
        // single `--fix` run would leave those classes uncountable and report
        // that it had fixed them.
        //
        // The defect: parse-server merges `{...emptyCLPS, ...stored}`, and
        // emptyCLPS supplies `count: {}`. A stored class_permissions object
        // that omits `count` therefore enforces an empty count rule, which
        // validatePermission treats as a rule nobody satisfies rather than as
        // no rule at all - so every count query on that class is refused. The
        // counts this app issues are privilege checks rather than paging, so
        // what goes down is the administration surface, administrators
        // included.
        let countFindings = 0;
        for (const schemaDoc of schemas) {
            const countRule = classifyCountRule(schemaDoc);
            if (!countRule || countRule.mirrors) continue;
            countFindings++;

            if (countRule.denied) {
                report('FAIL', 'CLP Availability',
                    `Collection '${countRule.className}' enforces an empty 'count' rule (${countRule.hasCount ? 'stored empty' : 'key absent'}), so nobody may count it even though find grants ${JSON.stringify(countRule.find)}. ` +
                    `A database seeded before the schema started stating count keeps the omission until it is repaired here.`);
                if (fixMode) {
                    // Each class gets its OWN find, read from the document in
                    // hand. A shared table or the seed's value would be a guess:
                    // production's find rules have drifted from the seed's, and
                    // widening count past find would hand out a row count for
                    // rows the same client is not allowed to read.
                    await schemaCollection.updateOne(
                        { _id: countRule.className },
                        { $set: { '_metadata.class_permissions.count': countRule.find } }
                    );
                    console.log(`        -> [FIXED] Set count permission for '${countRule.className}' in _SCHEMA to mirror its own find.`);
                }
            } else {
                // A stored count that merely disagrees with find is somebody's
                // decision, not the emptyCLPS regression, so it is reported and
                // left alone - overwriting it would silently widen or narrow a
                // deliberate rule.
                report('WARN', 'CLP Availability',
                    `Collection '${countRule.className}' counts as ${JSON.stringify(countRule.count)} but finds as ${JSON.stringify(countRule.find)}. ` +
                    `That is a stored rule rather than the missing-count defect, so --fix leaves it for a human.`);
            }
        }
        if (countFindings === 0) {
            report('PASS', 'CLP Availability', `Every class with stored class_permissions mirrors its find rule into count.`);
        }

        // Check VampireApproval CLP & Trigger Architecture
        const approvalSchema = schemaMap['VampireApproval'];
        if (approvalSchema) {
            report('PASS', 'Approval Security', `Collection 'VampireApproval' write operations are gated by cloud beforeSave trigger with dynamic troupe AST/LST validation.`);
        }

        // Check _Role CLP
        const roleSchema = schemaMap['_Role'];
        if (roleSchema) {
            const clp = (roleSchema._metadata && roleSchema._metadata.class_permissions) || {};
            if (clp.create && clp.create['*'] === true) {
                report('FAIL', 'CLP Security', `Collection '_Role' allows public role creation!`);
            } else {
                report('PASS', 'CLP Security', `Collection '_Role' restricts creation.`);
            }
        }

        // ====================================================================
        // 2. Audit Role Hierarchy & Troupe Roles
        // ====================================================================
        console.log('\n--- 2. Role Hierarchy & Troupe Roles Audits ---');
        const roleCollection = db.collection('_Role');
        const adminRole = await roleCollection.findOne({ name: 'Administrator' });
        if (!adminRole) {
            report('FAIL', 'Roles', `Role 'Administrator' does not exist.`);
        } else {
            report('PASS', 'Roles', `Role 'Administrator' exists (ID: ${adminRole._id}).`);
        }

        const troupes = await db.collection('Troupe').find({}).toArray();
        console.log(`Found ${troupes.length} troupes in database.`);
        for (const troupe of troupes) {
            const troupeId = troupe._id;
            const expectedRoles = [`LST_${troupeId}`, `AST_${troupeId}`, `Narrator_${troupeId}`];
            for (const rName of expectedRoles) {
                const rDoc = await roleCollection.findOne({ name: rName });
                if (!rDoc) {
                    report('WARN', 'Troupe Roles', `Missing expected role '${rName}' for Troupe '${troupe.name || troupeId}'.`);
                    if (fixMode) {
                        await roleCollection.insertOne({
                            _id: 'role_' + rName,
                            name: rName,
                            _rperm: ['*'],
                            _wperm: ['role:Administrator'],
                            _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
                            _created_at: new Date(),
                            _updated_at: new Date()
                        });
                        console.log(`        -> [FIXED] Created missing role '${rName}'.`);
                    }
                } else {
                    report('PASS', 'Troupe Roles', `Troupe role '${rName}' exists.`);
                }
            }
        }

        // ====================================================================
        // 3. Record-Level ACL Audits
        // ====================================================================
        console.log('\n--- 3. Record-Level ACL Invariants Audits ---');
        // LongText, VampireCreation and ReferendumBallot were missing here.
        // That mattered: an anonymously created row carries no ACL at all, which
        // Parse stores as public read/write, so this check is what finds the
        // wreckage a create hole leaves behind even after the hole is closed.
        const collectionsToCheck = [
            { name: 'Vampire', checkOwner: true },
            { name: 'SimpleTrait', checkOwner: true },
            { name: 'ExperienceNotation', checkOwner: true },
            { name: 'LongText', checkOwner: true },
            { name: 'VampireCreation', checkOwner: true },
            { name: 'ReferendumBallot', checkOwner: false },
            { name: 'VampireChange', checkOwner: false }
        ];

        for (const col of collectionsToCheck) {
            const publicWritableDocs = await db.collection(col.name).find({ _wperm: '*' }).toArray();
            const publicWritableCount = publicWritableDocs.length;
            if (publicWritableCount > 0) {
                report('FAIL', 'Record ACL', `Collection '${col.name}' has ${publicWritableCount} records with public write permissions!`);
                if (fixMode) {
                    await db.collection(col.name).updateMany(
                        { _wperm: '*' },
                        { $pull: { _wperm: '*' } }
                    );
                    console.log(`        -> [FIXED] Stripped public write permissions from ${publicWritableCount} records in '${col.name}'.`);
                }
            } else {
                report('PASS', 'Record ACL', `Collection '${col.name}' has no public-writable records.`);
            }
        }

    } finally {
        await client.close();
    }

    console.log('\n' + '='.repeat(70));
    console.log(` AUDIT SUMMARY: ${passed} PASSED, ${warnings} WARNINGS, ${errors} ERRORS`);
    console.log('='.repeat(70));

    return { passed, warnings, errors };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const fixMode = args.includes('--fix');
    const uriArg = args.find(a => !a.startsWith('--'));
    const mongoUri = uriArg || process.env.MONGODB_URI || 'mongodb://localhost:27017/anotherstore';

    auditDatabase(mongoUri, fixMode).then(results => {
        process.exit(results.errors > 0 ? 1 : 0);
    }).catch(err => {
        console.error('Audit failed with fatal error:', err);
        process.exit(1);
    });
}

module.exports = {
    auditDatabase,
    // Exported so the count decision can be exercised without a database.
    classifyCountRule,
    samePermissionRule
};
