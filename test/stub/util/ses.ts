console.log('Using stub (ses.js)'); /* eslint no-console: "off" */

/* istanbul ignore next */
export async function sendVerificationEmail(res, user, ref) {
  return Promise.resolve();
}

/* istanbul ignore next */
export async function sendVerificationWithCouponEmail(res, user, coupon, ref) {
  return Promise.resolve();
}

/* istanbul ignore next */
export async function sendInvitationEmail(res, { email, referrerId, referrer }) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendAutoClaimEmail({
  email, classId, className, wallet,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendPendingClaimEmail({
  email,
  classId,
  className,
  paymentId,
  claimToken,
}) {
  return Promise.resolve();
}
