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
  email, classIds, firstClassName, wallet,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendPendingClaimEmail({
  email,
  classIds,
  firstClassName,
  paymentId,
  claimToken,
}) {
  return Promise.resolve();
}

export function sendNFTBookListingEmail({
  classId,
  className,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookGiftPendingClaimEmail({
  fromName,
  toName,
  toEmail,
  message,
  classId,
  className,
  paymentId,
  claimToken,
  mustClaimToView,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookShippedEmail({
  email,
  classId,
  className,
  message,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookGiftClaimedEmail({
  className,
  fromEmail,
  fromName,
  toName,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookGiftSentEmail({
  fromEmail,
  fromName,
  toName,
  className,
  txHash,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookPendingClaimEmail({
  email,
  classId,
  className,
  paymentId,
  claimToken,
  mustClaimToView = false,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookSalesEmail({
  emails,
  isGift,
  giftToName,
  giftToEmail,
  buyerEmail,
  className,
  amount,
}) {
  return Promise.resolve();
}

export function sendNFTBookClaimedEmail({
  emails, classId, className, paymentId, wallet, message, buyerEmail,
}) {
  return Promise.resolve();
}
