import { EXTRA_EMAIL_BLACLIST } from '../constant';

const configRef = require('../util/firebase').configCollection;

let emailBlacklist = EXTRA_EMAIL_BLACLIST;
let emailNoDot = [];
let unsubscribeEmailBlacklist;
let unsubscribeEmailNoDot;

function pollEmailBlacklist() {
  try {
    const watchRef = configRef.doc('emailBlacklist');
    const watch = () => {
      if (!unsubscribeEmailBlacklist) {
        unsubscribeEmailBlacklist = watchRef.onSnapshot((docSnapshot) => {
          if (docSnapshot.exists) {
            const { list } = docSnapshot.data();
            emailBlacklist = list;
          }
        }, (err) => {
          console.error(err.message || err); // eslint-disable-line no-console
          if (typeof unsubscribeEmailBlacklist === 'function') {
            unsubscribeEmailBlacklist();
            unsubscribeEmailBlacklist = null;
          }
          const timer = setInterval(() => {
            console.log('Trying to restart watcher (email blacklist)...'); // eslint-disable-line no-console
            try {
              watch();
              clearInterval(timer);
            } catch (innerErr) {
              console.log('Watcher restart failed (email blacklist)'); // eslint-disable-line no-console
            }
          }, 10000);
        });
      }
    };
    watch();
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
  }
}

function pollEmailNoDot() {
  try {
    const watchRef = configRef.doc('emailNoDot');
    const watch = () => {
      if (!unsubscribeEmailNoDot) {
        unsubscribeEmailNoDot = watchRef.onSnapshot((docSnapshot) => {
          if (docSnapshot.exists) {
            const { list } = docSnapshot.data();
            emailNoDot = list;
          }
        }, (err) => {
          console.error(err.message || err); // eslint-disable-line no-console
          if (typeof unsubscribeEmailNoDot === 'function') {
            unsubscribeEmailNoDot();
            unsubscribeEmailNoDot = null;
          }
          const timer = setInterval(() => {
            console.log('Trying to restart watcher (email no dot)...'); // eslint-disable-line no-console
            try {
              watch();
              clearInterval(timer);
            } catch (innerErr) {
              console.log('Watcher restart failed (email no dot)'); // eslint-disable-line no-console
            }
          }, 10000);
        });
      }
    };
    watch();
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
  }
}

export function startPoller() {
  pollEmailBlacklist();
  pollEmailNoDot();
}

export function stopPoller() {
  if (typeof unsubscribeEmailBlacklist === 'function') {
    unsubscribeEmailBlacklist();
    unsubscribeEmailBlacklist = null;
  }
  if (typeof unsubscribeEmailNoDot === 'function') {
    unsubscribeEmailNoDot();
    unsubscribeEmailNoDot = null;
  }
}

export function getEmailBlacklist() {
  return emailBlacklist;
}

export function getEmailNoDot() {
  return emailNoDot;
}
