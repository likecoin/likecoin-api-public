/* eslint-disable @typescript-eslint/no-unused-vars */
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

export function sendNFTBookCartPendingClaimEmail({
  email,
  cartId,
  bookNames,
  paymentId,
  claimToken,
  isResend = false,
  site = '',
}) {
  return Promise.resolve();
}

export function sendNFTBookListingEmail({
  classId = '',
  bookName,
  site = '',
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
  bookName,
  paymentId,
  claimToken,
  isResend = false,
  site = '',
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
  isResend = false,
  site = '',
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
  cartId = '',
  bookName,
  paymentId,
  claimToken,
  from = '',
  isResend = false,
  site = '',
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
  quantity,
  originalPrice,
}) {
  return Promise.resolve();
}

export function sendNFTBookSalePaymentsEmail({
  classId = '',
  paymentId,
  email,
  bookName,
  payments,
  site = '',
}) {
  return Promise.resolve();
}

export function sendNFTBookClaimedEmail({
  emails, classId = '', bookName, paymentId, wallet, message, claimerEmail,
}) {
  return Promise.resolve();
}

export function sendNFTBookOutOfStockEmail({
  emails,
  classId = '',
  bookName,
  priceName,
}) {
  return Promise.resolve();
}
