/**
 * Close public read on `_User` rows that already exist.
 *
 * WHY THIS EXISTS. parse-server's `enforcePrivateUsers` is read in exactly one
 * place: the `_User` CREATE branch, and only when the write supplies no ACL.
 * Nothing rewrites a row that already exists. So every account created before
 * the option took effect keeps `_rperm: ['*']` forever, and the population
 * splits permanently into old-public and new-private -- which is worse than
 * either state on its own, because a bug then reproduces for some members and
 * not others, and which half you are in depends on when you signed up.
 *
 * This makes the population uniform. It is the only irreversible step in the
 * S11 work, and the only one that touches rows rather than schema.
 *
 * SAFETY, and none of it is optional:
 *
 *   - DRY RUN IS THE DEFAULT. It reports and changes nothing. Pass --apply to
 *     write. Put the dry-run output in the runbook before the real run.
 *   - A snapshot of {_id, _rperm, _wperm, _acl} is written to
 *     `_yorick_user_acl_backup` BEFORE any row is modified, and the run aborts
 *     if the snapshot is incomplete. That collection is the only way back.
 *   - Every rewritten row KEEPS ITS OWN objectId in `_rperm`. Read the next
 *     paragraph before touching that logic.
 *
 * THE FAILURE MODE IF A ROW LOSES ITS OWN ID. Login performs a sanitizing
 * re-fetch through `rest.get` under a non-master auth built from the user being
 * logged in. If the row's ACL denies that read, login does NOT fail: it falls
 * through to `filteredUser = { objectId: user.objectId }` and attaches the
 * session token anyway. The account then logs in "successfully" with an
 * attribute-less current user -- `admininterface` undefined, every gate closed,
 * no name anywhere -- and it presents as a client bug with nothing in the
 * server log. It would do this to every account at once. That is why the
 * snapshot is mandatory and why `verify` re-reads what it wrote.
 *
 * Idempotent: a row already closed is counted and skipped.
 *
 * Usage:
 *   node close_user_acls.js "<mongodb-uri>"            # dry run, the default
 *   node close_user_acls.js "<mongodb-uri>" --apply    # writes
 *   node close_user_acls.js "<mongodb-uri>" --verify   # re-read only
 *   node close_user_acls.js "<mongodb-uri>" --restore  # put the snapshot back
 */

'use strict';

var MongoClient = require('mongodb').MongoClient;

var SNAPSHOT = '_yorick_user_acl_backup';

/** Is this row still publicly readable? */
function isPublic(doc) {
    var rperm = doc._rperm || [];
    var acl = doc._acl || {};
    return rperm.indexOf('*') !== -1 ||
        Object.prototype.hasOwnProperty.call(acl, '*');
}

/**
 * The row as it should be once public read is closed.
 *
 * Mirrors what parse-server writes for a fresh signup: the row's own objectId
 * with read and write, and nothing else added. Any OTHER existing grant --
 * a role, another user -- is preserved untouched; this closes `*` and does not
 * otherwise redesign anybody's permissions.
 */
function closed(doc) {
    var rperm = (doc._rperm || []).filter(function (e) { return e !== '*'; });
    if (rperm.indexOf(doc._id) === -1) {
        rperm.push(doc._id);
    }

    var acl = {};
    Object.keys(doc._acl || {}).forEach(function (k) {
        if (k !== '*') { acl[k] = doc._acl[k]; }
    });
    acl[doc._id] = acl[doc._id] || {};
    acl[doc._id].r = true;
    // Write access is left exactly as found. A row whose owner could not write
    // it before is not granted write here -- that would be a different change.
    if (Object.prototype.hasOwnProperty.call(acl[doc._id], 'w') === false &&
        (doc._wperm || []).indexOf(doc._id) !== -1) {
        acl[doc._id].w = true;
    }

    return { _rperm: rperm, _acl: acl };
}

async function run(uri, mode) {
    var client = await MongoClient.connect(uri);
    try {
        var db = client.db();
        var users = db.collection('_User');
        var backup = db.collection(SNAPSHOT);

        if (mode === 'restore') {
            var saved = await backup.find({}).toArray();
            if (!saved.length) {
                throw new Error('No snapshot in ' + SNAPSHOT + '. Nothing to restore.');
            }
            for (var i = 0; i < saved.length; i++) {
                var row = saved[i];
                await users.updateOne(
                    { _id: row._id },
                    { $set: { _rperm: row._rperm, _wperm: row._wperm, _acl: row._acl } }
                );
            }
            console.log('Restored ' + saved.length + ' rows from ' + SNAPSHOT + '.');
            return 0;
        }

        var all = await users.find({}, { projection: { _rperm: 1, _wperm: 1, _acl: 1 } }).toArray();
        var open = all.filter(isPublic);

        console.log('_User rows            : ' + all.length);
        console.log('publicly readable     : ' + open.length);
        console.log('already closed        : ' + (all.length - open.length));

        if (mode === 'verify') {
            var stillOpen = open.map(function (d) { return d._id; });
            var missingSelf = all.filter(function (d) {
                return (d._rperm || []).indexOf(d._id) === -1;
            }).map(function (d) { return d._id; });
            console.log('');
            console.log('still publicly readable : ' + (stillOpen.length ? stillOpen.join(', ') : 'none'));
            // This is the check that matters. A row missing its own id cannot
            // be read by its owner, and login degrades silently -- see the
            // header. Non-empty here means RESTORE FROM THE SNAPSHOT.
            console.log('MISSING THEIR OWN ID    : ' + (missingSelf.length ? missingSelf.join(', ') : 'none'));
            return missingSelf.length ? 1 : 0;
        }

        if (!open.length) {
            console.log('');
            console.log('Nothing to do.');
            return 0;
        }

        if (mode !== 'apply') {
            console.log('');
            console.log('DRY RUN. Nothing was written. Re-run with --apply to write.');
            console.log('');
            console.log('Sample of what would change (first 5):');
            open.slice(0, 5).forEach(function (d) {
                var next = closed(d);
                console.log('  ' + d._id);
                console.log('    _rperm ' + JSON.stringify(d._rperm) + ' -> ' + JSON.stringify(next._rperm));
                console.log('    _acl   ' + JSON.stringify(d._acl) + ' -> ' + JSON.stringify(next._acl));
            });
            return 0;
        }

        // --- snapshot first, and prove it landed ---------------------------
        console.log('');
        console.log('Writing snapshot to ' + SNAPSHOT + '...');
        for (var s = 0; s < open.length; s++) {
            var d = open[s];
            await backup.updateOne(
                { _id: d._id },
                { $set: { _id: d._id, _rperm: d._rperm, _wperm: d._wperm, _acl: d._acl } },
                { upsert: true }
            );
        }
        var savedCount = await backup.countDocuments({ _id: { $in: open.map(function (d) { return d._id; }) } });
        if (savedCount !== open.length) {
            throw new Error('Snapshot is incomplete: ' + savedCount + ' of ' + open.length +
                ' rows saved. REFUSING TO MODIFY ANYTHING.');
        }
        console.log('Snapshot holds ' + savedCount + ' rows.');

        // --- rewrite --------------------------------------------------------
        var written = 0;
        for (var w = 0; w < open.length; w++) {
            var doc = open[w];
            var next = closed(doc);
            if (next._rperm.indexOf(doc._id) === -1) {
                throw new Error('Refusing to write ' + doc._id +
                    ' without its own id in _rperm. See the header of this file.');
            }
            await users.updateOne(
                { _id: doc._id },
                { $set: { _rperm: next._rperm, _acl: next._acl } }
            );
            written++;
        }
        console.log('Closed public read on ' + written + ' rows.');
        console.log('');
        console.log('Now re-run with --verify, and restart parse-server.');
        return 0;
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    var args = process.argv.slice(2);
    var uri = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];
    if (!uri) {
        console.error('Usage: node close_user_acls.js "<mongodb-uri>" [--apply|--verify|--restore]');
        process.exit(2);
    }
    var mode = 'dry';
    if (args.indexOf('--apply') !== -1) { mode = 'apply'; }
    if (args.indexOf('--verify') !== -1) { mode = 'verify'; }
    if (args.indexOf('--restore') !== -1) { mode = 'restore'; }

    run(uri, mode).then(function (code) {
        process.exit(code || 0);
    }, function (err) {
        console.error('FAILED: ' + err.message);
        process.exit(1);
    });
}

module.exports = { isPublic: isPublic, closed: closed, SNAPSHOT: SNAPSHOT };
