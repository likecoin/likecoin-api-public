/* eslint no-console: "off" */
const { execSync } = require('child_process');

function setStub() {
  console.log('Setting Stub');
  execSync('cp ./src/util/firebase.js ./src/util/firebase.js.bak || true');
  execSync('cp ./src/util/ses.js ./src/util/ses.js.bak || true');
  execSync('cp ./test/stub/util/* ./src/util/');
  execSync('cp ./config/accounts.js ./config/accounts.js.bak || true');
  execSync('cp ./test/stub/config/accounts.js ./config/accounts.js || true');
}

function unsetStub() {
  console.log('Unsetting Stub');
  execSync('mv ./src/util/firebase.js.bak ./src/util/firebase.js');
  execSync('mv ./src/util/ses.js.bak ./src/util/ses.js');
  execSync('mv ./config/accounts.js.bak ./config/accounts.js');
}

function stubAndTest() {
  setStub();
  process.on('SIGINT', () => {
    // catch SIGINT
    unsetStub();
  });
  try {
    execSync(`npm run ${process.argv.slice(2).join(' ')}`, { env: process.env, stdio: 'inherit' });
  } catch (e) {
    unsetStub();
    process.exit(1);
  }
  console.log('Done');
  unsetStub();
}

stubAndTest();
