/* eslint no-console: "off" */
const { execSync } = require('child_process');

function setStub() {
  console.log('Setting Stub');
  execSync('mkdir -p config');
  execSync('cp ./src/util/firebase.js ./src/util/firebase.js.bak || true');
  execSync('cp ./src/util/ses.js ./src/util/ses.js.bak || true');
  execSync('cp ./src/util/sendgrid.js ./src/util/sendgrid.js.bak || true');
  execSync('cp ./test/stub/util/* ./src/util/');
  execSync('cp ./config/accounts.js ./config/accounts.js.bak || true');
  execSync('cp ./config/config.js ./config/config.js.bak || true');
  execSync('cp ./test/stub/config/* ./config/');
}

function unsetStub() {
  console.log('Unsetting Stub');
  execSync('mv ./src/util/firebase.js.bak ./src/util/firebase.js');
  execSync('mv ./src/util/ses.js.bak ./src/util/ses.js');
  execSync('mv ./src/util/sendgrid.js.bak ./src/util/sendgrid.js');
  execSync('mv ./config/accounts.js.bak ./config/accounts.js');
  execSync('mv ./config/config.js.bak ./config/config.js');
}

function stubAndTest() {
  setStub();
  process.on('SIGINT', () => {
    // catch SIGINT
    unsetStub();
  });
  try {
    const [, , script, testFile = '*'] = process.argv;
    const testTarget = process.env.npm_package_config_test_file_pattern.replace('{}', testFile);
    execSync(`npm run ${script} ${testTarget}`, { env: process.env, stdio: 'inherit' });
  } catch (e) {
    unsetStub();
    process.exit(1);
  }
  console.log('Done');
  unsetStub();
}

stubAndTest();
