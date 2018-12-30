if pgrep mongod ; then
  pkill mongod
  mongod --repair
fi
mongod --nojournal --fork --syslog