# yorick
A Vampire character database compatible with By Night Studio's Mind's Eye Theatre Vampire the Masquerade

Licensed under the GNU Affero General Public License v3

# Quickstart with Nitrous.io
Nitrous.io is a great remote workstation that I tend to use when I need to make changes to code like this on the fly.

Start up a workstation with the node.js configuration. Copy the following text into a file name init.bash. Type `bash init.bash` into the provided terminal. When it's done you will have the dashboard running on port 4000 and the website running on 8080. The default dashboard username and password is tmp. You can use the preview buttons to get at them.

    #!/bin/bash
    set -x
    set -e
    
    sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv EA312927
    echo "deb http://repo.mongodb.org/apt/ubuntu trusty/mongodb-org/3.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.2.list
    sudo apt-get update
    sudo apt-get install -y mongodb-org
    sudo service mongod restart
    
    export NVM_DIR="/usr/local/opt/nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" # This loads nvm
    
    nvm install v4.4.0
    npm install -g parse-server parse-dashboard pm2
    
    cat > process.yaml << EOF
    apps:
      - script: parse-server
        args: '--appId APPLICATION_ID --masterKey MASTER_KEY --databaseURI "mongodb://127.0.0.1:27017/anotherstore" --mountPath "/parse/1" --cloud /home/nitrous/code/yorick/cloud/main.js --publicServerURL "http://${HOSTNAME}.nitrousapp.com:1337/parse/1" --serverURL "http://127.0.0.1:1337/parse/1"'
        watch: true
      - script: parse-dashboard
        args: '--config /home/nitrous/parse-dashboard-config.json --host 0.0.0.0 --port 4000 --allowInsecureHTTP=1'
      - script: /home/nitrous/code/yorick/server.js
        watch: true
        env:
          DEBUG: express:*
          PUBLIC_BASE: /home/nitrous/code/yorick/public
    EOF
    
    cat > parse-dashboard-config.json << EOF
    {
      "apps": [
        {
          "serverURL": "http://${HOSTNAME}.nitrousapp.com:1337/parse/1",
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
    
    pushd code
    [ ! -d yorick ] && git clone https://github.com/gnu-lorien/yorick.git
    pushd yorick
    git fetch
    git checkout migrate_to_parse_server
    git pull origin
    npm install
    find ./public -type f -exec sed -i s/localhost:1337/${HOSTNAME}.nitrousapp.com:1337/g {} \;
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
    popd
    
    pm2 start process.yaml
