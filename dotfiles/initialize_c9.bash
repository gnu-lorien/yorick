#!/bin/bash
set -x
set -e

sudo apt-get update
[ ! -f "/usr/local/bin/mongod" ] && sudo apt-get install -y mongodb-org
if pgrep mongod ; then
  pkill mongod
fi
mongod --nojournal --fork --syslog

export NVM_DIR="/home/ubuntu/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" # This loads nvm

nvm install v4.4.5
npm install -g parse-server parse-dashboard

cat > run.bash << EOF
export DEBUG=express:*
export CONFIG_FILE=/home/ubuntu/workspace/parse-server-config.json
export PUBLIC_BASE=/home/ubuntu/workspace/public
node /home/ubuntu/workspace/c9-parse-server.js
EOF

cat > parse-dashboard-config.json << EOF
{
  "apps": [
    {
      "serverURL": "https://${C9_HOSTNAME}/parse/1",
      "appId": "APPLICATION_ID",
      "masterKey": "MASTER_KEY",
      "appName": "yorick"
    }
  ],
  "users": [
    {
      "user": "tmp",
      "pass": "tmp"
    }
  ]
}
EOF

cat > parse-server-config.json << EOF
{
  "appId": "APPLICATION_ID",
  "appName": "Yorick",
  "masterKey": "MASTER_KEY",
  "databaseURI": "mongodb://localhost:27017/anotherstore",
  "mountPath": "/parse/1",
  "cloud": "/home/ubuntu/workspace/cloud/main.js",
  "verbose": true,
  "publicServerURL": "https://${C9_HOSTNAME}/parse/1",
  "serverURL": "http://0.0.0.0:8080/parse/1"
}
EOF

pushd ~/workspace

if git status ; then
  echo "Repo already here. Manage it yourself."
else
  git fetch
  git checkout develop
  git pull origin
  npm install
fi

pushd public/scripts/app
cat > siteconfig.js << EOF
// Includes file dependencies
define([
], function () {
    var ConfigPatron = {
        serverURL: "https://api.undergroundtheater.org/parse",
        redirect_uri: "https://patron.undergroundtheater.org"
    };

    var Config = {
        serverURL: "https://yorick-undergroundtheater-gnu-lorien.c9users.io/parse",
        redirect_uri: "https://${C9_HOSTNAME}/index.html",
        SAMPLE_TROUPE_ID: "zCQcZnlFx5"
    };

    return Config;
});
EOF
popd

pushd database_seed
mongoimport -h localhost -d anotherstore -c "_Cardinality" _Cardinality.json
mongoimport -h localhost -d anotherstore -c "_dummy" _dummy.json
mongoimport -h localhost -d anotherstore -c "_Index" _Index.json
mongoimport -h localhost -d anotherstore -c "_Installation" _Installation.json
mongoimport -h localhost -d anotherstore -c "_JobSchedule" _JobSchedule.json
mongoimport -h localhost -d anotherstore -c "_JobStatus" _JobStatus.json
mongoimport -h localhost -d anotherstore -c "_Join:changes:ExperienceNotation" "_Join changes ExperienceNotation.json"
mongoimport -h localhost -d anotherstore -c "_Join:patronages:Payment_PayPal" "_Join patronages Payment_PayPal.json"
mongoimport -h localhost -d anotherstore -c "_Join:roles:_Role" "_Join roles _Role.json"
mongoimport -h localhost -d anotherstore -c "_Join:towner:VampireCreation" "_Join towner VampireCreation.json"
mongoimport -h localhost -d anotherstore -c "_Join:troupes:Vampire" "_Join troupes Vampire.json"
mongoimport -h localhost -d anotherstore -c "_Join:users:_Role" "_Join users _Role.json"
mongoimport -h localhost -d anotherstore -c "_Metric" _Metric.json
mongoimport -h localhost -d anotherstore -c "_Product" _Product.json
mongoimport -h localhost -d anotherstore -c "_PushStatus" _PushStatus.json
mongoimport -h localhost -d anotherstore -c "_QueryToolQuery" _QueryToolQuery.json
mongoimport -h localhost -d anotherstore -c "_Role" _Role.json
mongoimport -h localhost -d anotherstore -c "_SCHEMA" _SCHEMA.json
mongoimport -h localhost -d anotherstore -c "_Session" _Session.json
mongoimport -h localhost -d anotherstore -c "_User" _User.json
mongoimport -h localhost -d anotherstore -c "bnsmetv1_ClanRule" bnsmetv1_ClanRule.json
mongoimport -h localhost -d anotherstore -c "bnsmetv1_ElderDisciplineRule" bnsmetv1_ElderDisciplineRule.json
mongoimport -h localhost -d anotherstore -c "bnsmetv1_RitualRule" bnsmetv1_RitualRule.json
mongoimport -h localhost -d anotherstore -c "bnsmetv1_TechniqueRule" bnsmetv1_TechniqueRule.json
mongoimport -h localhost -d anotherstore -c "CategoryProperties" CategoryProperties.json
mongoimport -h localhost -d anotherstore -c "ChangeType" ChangeType.json
mongoimport -h localhost -d anotherstore -c "CharacterPortrait" CharacterPortrait.json
mongoimport -h localhost -d anotherstore -c "CharacterRelationship" CharacterRelationship.json
mongoimport -h localhost -d anotherstore -c "Description" Description.json
mongoimport -h localhost -d anotherstore -c "ExperienceNotation" ExperienceNotation.json
mongoimport -h localhost -d anotherstore -c "SimpleTrait" SimpleTrait.json
mongoimport -h localhost -d anotherstore -c "Troupe" Troupe.json
mongoimport -h localhost -d anotherstore -c "TroupePortrait" TroupePortrait.json
mongoimport -h localhost -d anotherstore -c "Vampire" Vampire.json
mongoimport -h localhost -d anotherstore -c "VampireApproval" VampireApproval.json
mongoimport -h localhost -d anotherstore -c "VampireChange" VampireChange.json
mongoimport -h localhost -d anotherstore -c "VampireCreation" VampireCreation.json
popd
popd

bash run.bash