var fs = require('fs');
var path = require('path');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var password = require('parse-server/lib/password');

function parseEJSON(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') {
    if (val.$date) {
      return new Date(val.$date);
    }
    if (val.$oid) {
      try {
        return new ObjectID(val.$oid);
      } catch (e) {
        return val.$oid;
      }
    }
    if (Array.isArray(val)) {
      return val.map(parseEJSON);
    }
    var res = {};
    for (var k in val) {
      res[k] = parseEJSON(val[k]);
    }
    return res;
  }
  return val;
}

async function seedDatabase(databaseURI) {
  var client = await MongoClient.connect(databaseURI, { useNewUrlParser: true });
  var db = client.db();

  try {
    var userCount = await db.collection('_User').find({}).toArray().then(function(docs) { return docs.length; });

    if (userCount === 0) {
      console.log('Seeding database from database_seed directory...');
      var seedDir = path.join(__dirname, 'database_seed');
      var files = fs.readdirSync(seedDir);

      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.endsWith('.json')) continue;

        var colName = file.replace(/\.json$/, '');
        // Handle join filenames like "_Join changes ExperienceNotation.json" -> "_Join:changes:ExperienceNotation"
        if (colName.startsWith('_Join ')) {
          var parts = colName.split(' ');
          colName = parts[0] + ':' + parts[1] + ':' + parts[2];
        }

        var filePath = path.join(seedDir, file);
        var content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) continue;

        var lines = content.split('\n');
        var docs = [];
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j].trim();
          if (!line) continue;
          try {
            var rawDoc = JSON.parse(line);
            var parsedDoc = parseEJSON(rawDoc);
            docs.push(parsedDoc);
          } catch (err) {
            console.warn('Could not parse line in ' + file + ':', err.message);
          }
        }

        if (docs.length > 0) {
          try {
            await db.collection(colName).insertMany(docs);
          } catch (e) {
            // If already exists or error, continue
          }
        }
      }

      // Ensure test users exist with correct passwords
      var hashedDumbness = await password.hash('thedumbness');
      var hashedSampmem = await password.hash('sampmem');
      var hashedSampast = await password.hash('sampast');

      await db.collection('_User').updateOne(
        { username: 'devuser' },
        {
          $set: {
            username: 'devuser',
            _hashed_password: hashedDumbness,
            _wperm: ['m91umkbuQq'],
            _rperm: ['*', 'm91umkbuQq'],
            _acl: { m91umkbuQq: { w: true, r: true }, '*': { r: true } },
            _updated_at: new Date(),
            admininterface: true,
            storytellerinterface: true
          },
          $setOnInsert: {
            _id: 'm91umkbuQq',
            _created_at: new Date()
          }
        },
        { upsert: true }
      );

      await db.collection('_User').updateOne(
        { username: 'sampmem' },
        {
          $set: {
            username: 'sampmem',
            _hashed_password: hashedSampmem,
            _wperm: ['user_sampmem'],
            _rperm: ['*', 'user_sampmem'],
            _acl: { user_sampmem: { w: true, r: true }, '*': { r: true } },
            _updated_at: new Date(),
            admininterface: false,
            storytellerinterface: false
          },
          $setOnInsert: {
            _id: 'user_sampmem',
            _created_at: new Date()
          }
        },
        { upsert: true }
      );

      await db.collection('_User').updateOne(
        { username: 'sampast' },
        {
          $set: {
            username: 'sampast',
            _hashed_password: hashedSampast,
            _wperm: ['user_sampast'],
            _rperm: ['*', 'user_sampast'],
            _acl: { user_sampast: { w: true, r: true }, '*': { r: true } },
            _updated_at: new Date(),
            admininterface: false,
            storytellerinterface: true
          },
          $setOnInsert: {
            _id: 'user_sampast',
            _created_at: new Date()
          }
        },
        { upsert: true }
      );

      // Ensure test sample troupe exists
      await db.collection('Troupe').updateOne(
        { _id: 'WOad4CBTsG' },
        {
          $set: {
            name: 'Sample Troupe',
            _rperm: ['*'],
            _wperm: ['role:Administrator'],
            _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
            _updated_at: new Date()
          },
          $setOnInsert: {
            _id: 'WOad4CBTsG',
            _created_at: new Date()
          }
        },
        { upsert: true }
      );

      // Ensure Administrator and SiteAdministrator roles exist
      var adminRoles = ['Administrator', 'SiteAdministrator'];
      for (var a = 0; a < adminRoles.length; a++) {
        var aRoleName = adminRoles[a];
        var aRoleId = 'role_' + aRoleName;
        await db.collection('_Role').updateOne(
          { name: aRoleName },
          {
            $set: {
              name: aRoleName,
              _rperm: ['*'],
              _wperm: ['role:Administrator'],
              _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
              _updated_at: new Date()
            },
            $setOnInsert: {
              _id: aRoleId,
              _created_at: new Date()
            }
          },
          { upsert: true }
        );
      }

      // Add devuser to Administrator role using actual role _id
      var adminRole = await db.collection('_Role').findOne({ name: 'Administrator' });
      if (adminRole) {
        await db.collection('_Join:users:_Role').updateOne(
          { owningId: adminRole._id, relatedId: 'm91umkbuQq' },
          {
            $set: {
              owningId: adminRole._id,
              relatedId: 'm91umkbuQq'
            }
          },
          { upsert: true }
        );
      }

      // Ensure Troupe roles exist
      var troupeRoles = ['LST_WOad4CBTsG', 'AST_WOad4CBTsG', 'Narrator_WOad4CBTsG'];
      for (var r = 0; r < troupeRoles.length; r++) {
        var roleName = troupeRoles[r];
        var roleId = 'role_' + roleName;
        await db.collection('_Role').updateOne(
          { name: roleName },
          {
            $set: {
              name: roleName,
              _rperm: ['*'],
              _wperm: ['role:Administrator'],
              _acl: { '*': { r: true }, 'role:Administrator': { r: true, w: true } },
              _updated_at: new Date()
            },
            $setOnInsert: {
              _id: roleId,
              _created_at: new Date()
            }
          },
          { upsert: true }
        );
      }

      // Add sampast to AST_WOad4CBTsG role
      await db.collection('_Join:users:_Role').updateOne(
        { owningId: 'role_AST_WOad4CBTsG', relatedId: 'user_sampast' },
        {
          $set: {
            owningId: 'role_AST_WOad4CBTsG',
            relatedId: 'user_sampast'
          }
        },
        { upsert: true }
      );

      console.log('Database seeding complete.');
    }
  } finally {
    await client.close();
  }
}

module.exports = {
  seedDatabase: seedDatabase
};
