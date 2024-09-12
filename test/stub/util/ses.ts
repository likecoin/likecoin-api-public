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

export function sendNFTBookCartPendingClaimEmail({
  email,
  cartId,
  bookNames,
  paymentId,
  claimToken,
}) {
  return Promise.resolve();
}

export function sendNFTBookListingEmail({
  classId = '',
  collectionId = '',
  bookName,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookGiftPendingClaimEmail({
  fromName,
  toName,
  toEmail,
  message,
  classId = '',
  collectionId = '',
  bookName,
  paymentId,
  claimToken,
  mustClaimToView,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookCartGiftPendingClaimEmail({
  fromName,
  toName,
  toEmail,
  message,
  cartId,
  bookNames,
  paymentId,
  claimToken,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookPhysicalOnlyEmail({
  email,
  classId = '',
  collectionId = '',
  bookName,
  priceName = '',
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookShippedEmail({
  email,
  classId = '',
  collectionId = '',
  bookName,
  message,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookGiftClaimedEmail({
  bookName,
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
  bookName,
  txHash,
}) {
  return Promise.resolve();
}

/* istanbul ignore next */
export function sendNFTBookPendingClaimEmail({
  email,
  classId = '',
  collectionId = '',
  cartId = '',
  bookName,
  paymentId,
  claimToken,
  from = '',
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
  bookName,
  amount,
  originalPrice,
  phone,
  shippingDetails,
  shippingCost,
}) {
  return Promise.resolve();
}

export function sendNFTBookSalePaymentsEmail({
  classId = '',
  collectionId = '',
  paymentId,
  email,
  bookName,
  payments,
}) {
  return Promise.resolve();
}

export function sendNFTBookClaimedEmail({
  emails, classId = '', collectionId = '', bookName, paymentId, wallet, message, claimerEmail,
}) {
  return Promise.resolve();
}
