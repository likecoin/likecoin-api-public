/* eslint no-console: "off" */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execSync } = require('child_process');

function setStub() {
  console.log('Setting Stub');
  execSync('mkdir -p config');
  execSync('cp ./src/util/fileupload.ts ./src/util/fileupload.ts.bak || true');
  execSync('cp ./src/util/firebase.ts ./src/util/firebase.ts.bak || true');
  execSync('cp ./src/util/ses.ts ./src/util/ses.ts.bak || true');
  execSync('cp ./src/util/sendgrid.ts ./src/util/sendgrid.ts.bak || true');
  execSync('cp ./src/util/cosmos/api.ts ./src/util/cosmos/api.ts.bak || true');
  execSync('rsync -a ./test/stub/util/ ./src/util/');
  execSync('cp ./config/accounts.js ./config/accounts.js.bak || true');
  execSync('cp ./config/config.js ./config/config.js.bak || true');
  execSync('cp ./config/secret.js ./config/secret.js.bak || true');
  execSync('cp ./test/stub/config/* ./config/');
}

function unsetStub() {
  console.log('Unsetting Stub');
  execSync('mv ./src/util/fileupload.ts.bak ./src/util/fileupload.ts');
  execSync('mv ./src/util/firebase.ts.bak ./src/util/firebase.ts');
  execSync('mv ./src/util/ses.ts.bak ./src/util/ses.ts');
  execSync('mv ./src/util/sendgrid.ts.bak ./src/util/sendgrid.ts');
  execSync('mv ./src/util/cosmos/api.ts.bak ./src/util/cosmos/api.ts');
  execSync('mv ./config/accounts.js.bak ./config/accounts.js');
  execSync('mv ./config/config.js.bak ./config/config.js');
  execSync('mv ./config/secret.js.bak ./config/secret.js');
}

function stubAndTest() {
  setStub();
  process.on('SIGINT', () => {
    // catch SIGINT
    unsetStub();
  });
  try {
    const [, , script] = process.argv;
    console.log(script);
    execSync(`npm run ${script}`, { env: process.env, stdio: 'inherit' });
  } catch (e) {
    unsetStub();
    process.exit(1);
  }
  console.log('Done');
  unsetStub();
}

stubAndTest();
