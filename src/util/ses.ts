/* eslint-disable no-underscore-dangle */
import { getBasicV2Template, getNFTTwoContentWithMessageAndButtonTemplate } from '@likecoin/edm';
import { SES } from '@aws-sdk/client-ses';
import {
  TEST_MODE,
  CUSTOMER_SERVICE_URL,
  CUSTOMER_SERVICE_EMAIL,
  SALES_EMAIL,
  SYSTEM_EMAIL,
  CHAIN_EXPLORER_URL,
  PLUS_MONTHLY_PRICE,
  SUPPORTED_PLUS_CURRENCIES,
  type SupportedPlusCurrency,
} from '../constant';
import { convertUSDPriceToCurrency } from './pricing';
import {
  getPlusGiftPageClaimURL,
  getPlusPageURL,
  getBook3NFTClaimPageURL,
  getBook3NFTClassPageURL,
  getBook3PortfolioPageURL,
} from './liker-land';
import {
  getNFTBookStoreClassPageURL,
  getNFTBookStoreSendPageURL,
} from './api/likernft/book';
import { TransactionFeeInfo } from './api/likernft/book/type';

// eslint-disable-next-line import/no-dynamic-require, global-require
const awsConfig = TEST_MODE ? {} : require('../../config/aws.json');

const ses = new SES(TEST_MODE ? {} : {
  region: awsConfig.region,
  credentials: {
    accessKeyId: awsConfig.accessKeyId,
    secretAccessKey: awsConfig.secretAccessKey,
  },
});

function formatEmailDecimalNumber(decimal: number) {
  return (decimal / 100).toFixed(2);
}

export async function sendVerificationEmail(res, user, ref) {
  const subject = res.__('Email.VerifyEmail.subject');
  const params = {
    Source: SYSTEM_EMAIL,
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendVerificationEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [user.email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${subject}` : subject,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title: res.__('Email.VerifyEmail.subject'),
            content: res.__('Email.VerifyEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              ref,
            }) + res.__('Email.signature'),
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendNFTBookListingEmail({
  classId = '',
  bookName,
}) {
  const title = `New NFT Book listing: ${bookName}`;
  const nftPageURLEn = getBook3NFTClassPageURL({ classId });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookListingEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content: `<p>A new NFT Book <a href="${nftPageURLEn}">${bookName}</a> has been listed.</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendNFTBookPendingClaimEmail({
  email,
  classId = '',
  bookName,
  paymentId,
  claimToken,
  from = '',
  isResend = false,
  displayName = '',
  language = 'zh',
}: {
  email: string;
  classId?: string;
  bookName: string;
  paymentId: string;
  claimToken: string;
  from?: string;
  isResend?: boolean;
  displayName?: string;
  language?: string;
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const title = isEn
    ? `${isResend ? '(Reminder) ' : ''}Read your ebook`
    : `${isResend ? '（提示）' : ''}閱讀你的電子書`;
  const nftPageURL = getBook3NFTClassPageURL({ classId, language: lang });
  const claimPageURL = getBook3NFTClaimPageURL({
    classId,
    paymentId,
    token: claimToken,
    // NOTE: claimToken may be empty, resulting in an incomplete URL
    type: 'nft_book',
    language: lang,
  });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookPendingClaimEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [email],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${displayName || 'reader'},</p>
            <p>Thanks for ${isResend ? 'previously ' : ''}purchasing "<a href="${nftPageURL}">${bookName}</a>".</p>
            <p>Click the button below to claim your ebook and start reading.</p>`,
              buttonText1: 'Claim your ebook',
              buttonHref1: claimPageURL,
              append1: `<p>If you have any questions, please contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a>.
            <br>May you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>
            <p>[${from}]</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的${displayName || '讀者'}：</p>
            <p>感謝你${isResend ? '先前' : ''}購買<a href="${nftPageURL}">《${bookName}》</a>。</p>
            <p>按以下按鈕領取你的電子書，即可開始閱讀。</p>`,
              buttonText1: '領取我的電子書',
              buttonHref1: claimPageURL,
              append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>
            <p>[${from}]</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendNFTBookCartPendingClaimEmail({
  cartId,
  bookNames,
  paymentId,
  claimToken,
  isResend = false,
  displayName = '',
  language = 'zh',
}: {
  cartId: string;
  bookNames: string[];
  paymentId: string;
  claimToken: string;
  isResend?: boolean;
  displayName?: string;
  language?: string;
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const title = isEn
    ? `${isResend ? '(Reminder) ' : ''}Read your ebook`
    : `${isResend ? '（提示）' : ''}閱讀你的電子書`;
  const claimPageURL = getBook3NFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: lang,
  });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookCartPendingClaimEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [SALES_EMAIL], // send to SALES_EMAIL instead of email before revamp
      // BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${displayName || 'reader'},</p>
            <p>Thank you for ${isResend ? 'previously ' : ''}purchasing the following ebooks:</p>
            <ul>${bookNames.map((name) => `<li>"${name}"</li>`).join('')}</ul>
            <p>Click the button below to claim your ebooks and start reading.</p>`,
              buttonText1: 'Claim your ebooks',
              buttonHref1: claimPageURL,
              append1: `<p>If you have any questions, please contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a>.
            <br>May you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>
            <p>[${paymentId}]</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的${displayName || '讀者'}：</p>
            <p>感謝${isResend ? '你先前' : ''}購買以下電子書：</p>
            <ul>${bookNames.map((name) => `<li>《${name}》</li>`).join('')}</ul>
            <p>按以下按鈕領取你的電子書，即可開始閱讀。</p>`,
              buttonText1: '領取我的電子書',
              buttonHref1: claimPageURL,
              append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>
            <p>[${paymentId}]</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

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
  language = 'zh',
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const title = isEn
    ? `${isResend ? '(Reminder) ' : ''}${fromName} has sent you an ebook gift from 3ook.com`
    : `${isResend ? '（提示）' : ''}${fromName} 贈你一本電子書禮物`;
  const nftPageURL = getBook3NFTClassPageURL({ classId, language: lang });
  const claimPageURL = getBook3NFTClaimPageURL({
    classId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: lang,
    email: toEmail,
  });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftPendingClaimEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [toEmail],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${toName || 'reader'},</p>
            <p>${fromName} has ${isResend ? 'previously ' : ''}sent you "<a href="${nftPageURL}">${bookName}</a>" as a gift.</p>
            <p>Click the button below to claim your ebook and start reading.</p>`,
              messageTitle1: `${fromName}'s message`,
              messageContent1: message,
              buttonText1: 'Claim your ebook',
              buttonHref1: claimPageURL,
              append1: `<p>If you have any questions, please contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a>.
            <br>May you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${toName || '讀者'}：</p>
            <p>${fromName} ${isResend ? '先前' : ''}贈送你這本電子書：</p>
            <p><a href="${nftPageURL}">《${bookName}》</a></p>
            <p>請點擊下方按鈕登入系統，打開電子書閱讀。</p>`,
              messageTitle1: `${fromName} 的留言`,
              messageContent1: message,
              buttonText1: '領取電子書',
              buttonHref1: claimPageURL,
              append1: `<p>如有任何疑問，歡迎聯絡我們的<a href="${CUSTOMER_SERVICE_URL}">客戶服務</a>。
            <br>願你享受閱讀的樂趣。</p>
            <p>3ook.com 電子書店</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

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
  language = 'zh',
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const title = isEn
    ? `${isResend ? '(Reminder) ' : ''}${fromName} has sent you an ebook gift from 3ook.com`
    : `${isResend ? '（提示）' : ''}${fromName} 送了電子書禮物給你`;
  const claimPageURL = getBook3NFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: lang,
    email: toEmail,
  });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookCartGiftPendingClaimEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [toEmail],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${toName || 'reader'},</p>
            <p>${fromName} has ${isResend ? 'previously ' : ''}sent you the following ebooks as a gift:</p>
            <ul>${bookNames.map((name) => `<li>"${name}"</li>`).join('')}</ul>
            <p>Click the button below to claim your ebooks and start reading.</p>`,
              messageTitle1: `${fromName}'s message`,
              messageContent1: message,
              buttonText1: 'Claim your ebooks',
              buttonHref1: claimPageURL,
              append1: `<p>If you have any questions, please contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a>.
            <br>May you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${toName || '讀者'}：</p>
            <p>${fromName} ${isResend ? '先前' : ''}贈送了以下電子書給你：</p>
            <ul>${bookNames.map((name) => `<li>《${name}》</li>`).join('')}</ul>
            <p>按以下按鈕領取你的電子書，即可開始閱讀。</p>`,
              messageTitle1: `${fromName} 的留言`,
              messageContent1: message,
              buttonText1: '領取我的電子書',
              buttonHref1: claimPageURL,
              append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendNFTBookGiftClaimedEmail({
  bookName,
  fromEmail,
  fromName,
  toName,
  language = 'zh',
}) {
  const isEn = language === 'en';
  const title = isEn
    ? `${toName} has accepted your ebook gift ${bookName}`
    : `${toName} 已接受你的禮物電子書 ${bookName}`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftClaimedEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${fromName},</p>
            <p>Your ebook gift of ${bookName} has been accepted by ${toName}.
            <br>Author will soon sign and send the ebook copy to ${toName}</p>
            <p>Thank you for sharing the joy of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${fromName}：</p>
            <p>你送給 ${toName} 的《${bookName}》已被接受。
            <br>作者將會在稍後簽署給發送電子書給 ${toName} </p>
            <p>感謝你分享閱讀的樂趣</p>
            <p>3ook.com 書店</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendNFTBookGiftSentEmail({
  fromEmail,
  fromName,
  toName,
  bookName,
  txHash,
  language = 'zh',
}) {
  const isEn = language === 'en';
  const title = isEn
    ? `Your ebook gift ${bookName} to ${toName} has been delivered`
    : `已發送了你贈給 ${toName} 的電子書`;
  const txURL = `${CHAIN_EXPLORER_URL}/tx/${txHash}`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftSentEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${fromName},</p>
            <p>Your gift ${bookName} has been delivered to ${toName}.
            <br>For technical details, visit <a href="${txURL}">transaction detail page</a></p>
            <p>Thank you for sharing the joy of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${fromName}：</p>
            <p>你購買並送給 ${toName} 的電子書《${bookName}》，已成功送出。</p>
            <p>${toName} 現在可以登入系統後，在書架上打開電子書閱讀。</p>
            <p>感謝你分享閱讀的樂趣。</p>
            <p>3ook.com 電子書店</p>
            <p>*如需協助，請把此<a href="${txURL}">詳細發送記錄</a>報告客服。</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendNFTBookManualDeliverSentEmail({
  email,
  classId,
  bookName,
  txHash,
  displayName = '',
  language = 'zh',
}: {
  email: string;
  classId: string;
  bookName: string;
  txHash: string;
  displayName?: string;
  language?: string;
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const title = isEn
    ? `Your ebook ${bookName} has been delivered`
    : `你的電子書《${bookName}》已經發送`;
  const nftPageURL = getBook3NFTClassPageURL({ classId, language: lang });
  const portfolioURL = getBook3PortfolioPageURL({ language: lang });
  const txURL = `${CHAIN_EXPLORER_URL}/tx/${txHash}`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookManualDeliverSentEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [email],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${displayName || 'reader'},</p>
            <p>Your ebook "<a href="${nftPageURL}">${bookName}</a>" has been personally signed and delivered by the author.</p>
            <p>Please visit your <a href="${portfolioURL}">Bookshelf on 3ook.com bookstore</a> to read your ebook. For technical details, visit <a href="${txURL}">transaction detail page</a>.</p>`,
              buttonText1: 'Go to my Bookshelf',
              buttonHref1: portfolioURL,
              append1: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${displayName || '讀者'}：</p>
            <p>你購買的 <a href="${nftPageURL}">《${bookName}》</a> 已經由作者親手簽發。</p>
            <p>請到你的 <a href="${portfolioURL}">3ook.com 書店的書架</a>閱讀你的電子書。如需瀏覽技術細節，請按<a href="${txURL}">此連結</a>。</p>`,
              buttonText1: '前往我的書架',
              buttonHref1: portfolioURL,
              append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendAutoDeliverNFTBookSalesEmail({
  email,
  classId,
  claimerEmail,
  buyerEmail,
  bookName,
  feeInfo,
  wallet,
  coupon,
  from,
  language = 'zh',
}: {
  email: string;
  classId: string;
  paymentId: string;
  claimerEmail: string;
  buyerEmail: string;
  bookName: string;
  feeInfo: TransactionFeeInfo;
  wallet: string;
  coupon?: string;
  from?: string;
  language?: string;
}) {
  const isEn = language === 'en';
  const {
    priceInDecimal,
    originalPriceInDecimal,
    channelCommission,
    customPriceDiffInDecimal,
    likerLandTipFeeAmount,
    royaltyToSplit,
  } = feeInfo;
  let customPriceDiffAfterFee = customPriceDiffInDecimal - likerLandTipFeeAmount;
  customPriceDiffAfterFee = Math.max(0, customPriceDiffAfterFee);
  const totalRevenue = royaltyToSplit + channelCommission + customPriceDiffAfterFee;
  const fxVarianceDiff = priceInDecimal - customPriceDiffInDecimal - originalPriceInDecimal;
  const hasFxVariance = Math.round(fxVarianceDiff * 100) !== 0;

  let title: string;
  let content: string;
  if (isEn) {
    const fxVarianceNote = hasFxVariance ? 'includes FX variance, ' : '';
    title = `Order for "${bookName}"`;
    content = `<p>Congratulations! An order for "${bookName}" has been received and automatically delivered.</p>`;
    if (coupon) content += `<p>Coupon: ${coupon}</p>`;
    content += '<table>';
    content += `<tr><td>Price:</td><td>USD ${formatEmailDecimalNumber(priceInDecimal - customPriceDiffInDecimal)} (${fxVarianceNote}original: USD ${formatEmailDecimalNumber(originalPriceInDecimal)})</td></tr>`;
    if (customPriceDiffAfterFee) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(customPriceDiffAfterFee)} (extra reader support)</td></tr>`;
    content += `<tr><td>Revenue:</td><td>USD ${formatEmailDecimalNumber(royaltyToSplit)} (royalty)</td></tr>`;
    if (from) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(channelCommission)} (channel: ${from})</td></tr>`;
    content += `<tr><td>Total:</td><td>USD ${formatEmailDecimalNumber(totalRevenue)}</td></tr>`;
    content += '</table>';
    if (buyerEmail !== claimerEmail) {
      content += `<p>Buyer email: ${buyerEmail}</p>`;
    }
    content += `<p>Reader email: ${claimerEmail}</p>`;
    content += `<p>Reader wallet: ${wallet}</p>`;
    content += `<p><a href="${getNFTBookStoreClassPageURL(classId)}">[Manage Orders]</a></p>`;
  } else {
    const fxVarianceNote = hasFxVariance ? '（包含讀者貨幣的滙率差）,' : '';
    title = `《${bookName}》訂單`;
    content = `<p>恭喜，收到《${bookName}》的訂單，作品已經自動發送。</p>`;
    if (coupon) content += `<p>優惠碼：${coupon}</p>`;
    content += '<table>';
    content += `<tr><td>售價：</td><td>USD ${formatEmailDecimalNumber(priceInDecimal - customPriceDiffInDecimal)}（${fxVarianceNote}原價：USD ${formatEmailDecimalNumber(originalPriceInDecimal)}）</td></tr>`;
    if (customPriceDiffAfterFee) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(customPriceDiffAfterFee)}（讀者額外支持）</td></tr>`;
    content += `<tr><td>收益：</td><td>USD ${formatEmailDecimalNumber(royaltyToSplit)}（權利金）</td></tr>`;
    if (from) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(channelCommission)}（通路：${from}）</td></tr>`;
    content += `<tr><td>總計：</td><td>USD ${formatEmailDecimalNumber(totalRevenue)}</td></tr>`;
    content += '</table>';
    if (buyerEmail !== claimerEmail) {
      content += `<p>買家電郵：${buyerEmail}</p>`;
    }
    content += `<p>讀者電郵：${claimerEmail}</p>`;
    content += `<p>讀者錢包：${wallet}</p>`;
    content += `<p><a href="${getNFTBookStoreClassPageURL(classId)}">[管理訂單]</a></p>`;
  }

  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendAutoDeliverNFTBookSalesEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content,
          }).body,
        },
      },
    },
  };
  if (email) {
    (params.Destination as any).ToAddresses = [email];
  }
  return ses.sendEmail(params);
}

export function sendNFTBookSalePaymentsEmail({
  classId = '',
  paymentId,
  email,
  bookName,
  payments,
  language = 'zh',
}) {
  const isEn = language === 'en';
  const hasRoyalty = payments.some(({ type }) => type === 'connectedWallet');
  const totalAmount = payments.reduce((acc, { amount }) => acc + amount, 0);
  const lang = isEn ? 'en' : 'zh-Hant';
  const nftPageURL = getBook3NFTClassPageURL({ classId, language: lang });

  let title: string;
  let content: string;
  if (isEn) {
    const paymentTypeLabel = hasRoyalty ? 'Royalty' : 'Commission';
    title = `${paymentTypeLabel} Received: US$${formatEmailDecimalNumber(totalAmount * 100)} for ${bookName}`;
    content = '<p>Dear Book Lover,</p>';
    content += '<p>Congratulations!</p>';
    content += `<p>Someone has just purchased the book <a href="${nftPageURL}">${bookName}</a>.</p>`;
    content += '<p>As a result, you have received the following payment:</p>';
    content += '<table>';
    const labelMap: { [key: string]: string } = {
      connectedWallet: 'Royalty:',
      channelCommission: 'Commission:',
    };
    payments.forEach(({ amount, type }) => {
      const label = labelMap[type] || 'Other:';
      content += `<tr><td>${label}</td><td>US$${formatEmailDecimalNumber(amount * 100)}</td></tr>`;
    });
    content += '</table>';
    content += `<p>Reference ID: ${paymentId}</p>`;
    content += '<p>Thank you for being part of the community.</p>';
    content += '<p>Warm regards,</p>';
    content += '<p>3ook.com</p>';
  } else {
    const paymentTypeLabel = hasRoyalty ? '版稅' : '佣金';
    title = `收到${paymentTypeLabel}：US$${formatEmailDecimalNumber(totalAmount * 100)}（${bookName}）`;
    content = '<p>親愛的書友：</p>';
    content += '<p>恭喜！</p>';
    content += `<p>有人剛剛購買了 <a href="${nftPageURL}">${bookName}</a>。</p>`;
    content += '<p>因此，你收到了以下款項：</p>';
    content += '<table>';
    const labelMap: { [key: string]: string } = {
      connectedWallet: '版稅：',
      channelCommission: '佣金：',
    };
    payments.forEach(({ amount, type }) => {
      const label = labelMap[type] || '其他：';
      content += `<tr><td>${label}</td><td>US$${formatEmailDecimalNumber(amount * 100)}</td></tr>`;
    });
    content += '</table>';
    content += `<p>參考編號：${paymentId}</p>`;
    content += '<p>感謝你成為社區的一分子。</p>';
    content += '<p>3ook.com</p>';
  }

  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookSalePaymentsEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [email],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendManualNFTBookSalesEmail({
  email,
  classId,
  paymentId,
  claimerEmail,
  buyerEmail,
  bookName,
  feeInfo,
  wallet,
  coupon,
  from,
  language = 'zh',
}: {
  email: string;
  classId: string;
  paymentId: string;
  claimerEmail: string;
  buyerEmail: string;
  bookName: string;
  feeInfo: TransactionFeeInfo;
  wallet: string;
  coupon?: string;
  from?: string;
  language?: string;
}) {
  const isEn = language === 'en';
  const {
    priceInDecimal,
    originalPriceInDecimal,
    channelCommission,
    customPriceDiffInDecimal,
    likerLandTipFeeAmount,
    royaltyToSplit,
  } = feeInfo;
  let customPriceDiffAfterFee = customPriceDiffInDecimal - likerLandTipFeeAmount;
  customPriceDiffAfterFee = Math.max(0, customPriceDiffAfterFee);
  const totalRevenue = royaltyToSplit + channelCommission + customPriceDiffAfterFee;
  const fxVarianceDiff = priceInDecimal - customPriceDiffInDecimal - originalPriceInDecimal;
  const hasFxVariance = Math.round(fxVarianceDiff * 100) !== 0;

  let title: string;
  let content: string;
  if (isEn) {
    const fxVarianceNote = hasFxVariance ? 'includes FX variance, ' : '';
    title = `Order received — please sign and deliver "${bookName}"`;
    content = `<p>Congratulations! An order for "${bookName}" has been received. Please go to the author management page to sign and deliver.</p>`;
    if (coupon) content += `<p>Coupon: ${coupon}</p>`;
    content += '<table>';
    content += `<tr><td>Price:</td><td>USD ${formatEmailDecimalNumber(priceInDecimal - customPriceDiffInDecimal)} (${fxVarianceNote}original: USD ${formatEmailDecimalNumber(originalPriceInDecimal)})</td></tr>`;
    if (customPriceDiffAfterFee) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(customPriceDiffAfterFee)} (extra reader support)</td></tr>`;
    content += `<tr><td>Revenue:</td><td>USD ${formatEmailDecimalNumber(royaltyToSplit)} (royalty)</td></tr>`;
    if (from) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(channelCommission)} (channel: ${from})</td></tr>`;
    content += `<tr><td>Total:</td><td>USD ${formatEmailDecimalNumber(totalRevenue)}</td></tr>`;
    content += '</table>';
    if (buyerEmail !== claimerEmail) {
      content += `<p>Buyer email: ${buyerEmail}</p>`;
    }
    content += `<p>Reader email: ${claimerEmail}</p>`;
    content += `<p>Reader wallet: ${wallet}</p>`;
    content += `<p><a href="${getNFTBookStoreSendPageURL(classId, paymentId)}">[Sign & Deliver]</a></p>`;
  } else {
    const fxVarianceNote = hasFxVariance ? '（包含讀者貨幣的滙率差）,' : '';
    title = `收到訂單，請簽發《${bookName}》訂單`;
    content = `<p>恭喜，收到《${bookName}》的訂單，請到作者管理介面簽發。</p>`;
    if (coupon) content += `<p>優惠碼：${coupon}</p>`;
    content += '<table>';
    content += `<tr><td>售價：</td><td>USD ${formatEmailDecimalNumber(priceInDecimal - customPriceDiffInDecimal)}（${fxVarianceNote}原價：USD ${formatEmailDecimalNumber(originalPriceInDecimal)}）</td></tr>`;
    if (customPriceDiffAfterFee) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(customPriceDiffAfterFee)}（讀者額外支持）</td></tr>`;
    content += `<tr><td>收益：</td><td>USD ${formatEmailDecimalNumber(royaltyToSplit)}（權利金）</td></tr>`;
    if (from) content += `<tr><td></td><td>USD ${formatEmailDecimalNumber(channelCommission)}（通路：${from}）</td></tr>`;
    content += `<tr><td>總計：</td><td>USD ${formatEmailDecimalNumber(totalRevenue)}</td></tr>`;
    content += '</table>';
    if (buyerEmail !== claimerEmail) {
      content += `<p>買家電郵：${buyerEmail}</p>`;
    }
    content += `<p>讀者電郵：${claimerEmail}</p>`;
    content += `<p>讀者錢包：${wallet}</p>`;
    content += `<p><a href="${getNFTBookStoreSendPageURL(classId, paymentId)}">[簽發作品]</a></p>`;
  }

  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendManualNFTBookSalesEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content,
          }).body,
        },
      },
    },
  };
  if (email) {
    (params.Destination as any).ToAddresses = [email];
  }
  return ses.sendEmail(params);
}

export function sendNFTBookOutOfStockEmail({
  email,
  classId = '',
  bookName,
  priceName,
  language = 'zh',
}) {
  if (!email) return Promise.resolve();
  const isEn = language === 'en';
  const url = getNFTBookStoreClassPageURL(classId);
  const title = isEn
    ? `Your book ${bookName} ${priceName} is sold out`
    : `你的書籍 ${bookName} ${priceName} 已售罄`;
  const content = isEn
    ? `<p>Dear Creator,</p>
  <br/>
  <p>Congratulations!</p>
  <p>Your book ${bookName} ${priceName} is sold out.</p>
  <p>Please <a href="${url}">restock your book</a> to continue selling.</p>
  <br/>
  <p>3ook.com Bookstore</p>`
    : `<p>親愛的創作者：</p>
  <br/>
  <p>恭喜！</p>
  <p>你的書籍 ${bookName} ${priceName} 已售罄。</p>
  <p>請<a href="${url}">補貨</a>以繼續銷售。</p>
  <br/>
  <p>3ook.com 書店</p>`;
  const params = {
    Source: SYSTEM_EMAIL,
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookOutOfStockEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [email],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

const PLUS_CURRENCY_SYMBOLS: Record<SupportedPlusCurrency, string> = {
  usd: 'US$',
  hkd: 'HK$',
  twd: 'NT$',
};

function formatPlusMonthlyPrice(currency: SupportedPlusCurrency): string {
  const amount = convertUSDPriceToCurrency(PLUS_MONTHLY_PRICE, currency);
  const formatted = currency === 'usd' ? amount.toFixed(2) : Math.round(amount).toString();
  return `${PLUS_CURRENCY_SYMBOLS[currency]}${formatted}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sendPlusBookPromoCodeEmail({
  email,
  code,
  bookNames,
  displayName = '',
  ownerDisplayName = '',
  voiceName = '',
  language = 'zh',
  currency = 'usd',
  fromLikerId,
}: {
  email: string;
  code: string;
  bookNames: string[];
  displayName?: string;
  ownerDisplayName?: string;
  voiceName?: string;
  language?: string;
  currency?: SupportedPlusCurrency;
  fromLikerId?: string;
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const ownerName = (ownerDisplayName.replace(/[\r\n]+/g, ' ').trim()) || '3ook.com';
  const hasVoice = !!voiceName;
  const safeCurrency = (SUPPORTED_PLUS_CURRENCIES as readonly string[]).includes(currency)
    ? currency
    : 'usd';
  const monthlyPriceLabel = formatPlusMonthlyPrice(safeCurrency);
  const safeDisplayName = displayName ? escapeHtml(displayName) : '';
  const safeOwnerName = escapeHtml(ownerName);
  const safeVoiceName = voiceName ? escapeHtml(voiceName) : '';
  const safeBookNames = bookNames.map(escapeHtml);
  const subjectTitle = isEn
    ? `A surprise for ${ownerName} readers — unlock 3ook.com Plus membership!`
    : `${ownerName} 讀者的專屬驚喜，開信即享 3ook.com Plus 會員資格！`;
  const htmlTitle = escapeHtml(subjectTitle);
  let voice = { leadIn: '', bullet: '', note: '' };
  if (hasVoice) {
    voice = isEn
      ? {
        leadIn: `<p>Beyond unlocking AI reading features across your library, there's a hidden surprise — listen to your books in ${safeVoiceName}'s voice!</p>`,
        bullet: `<li>Exclusive! Listen to books narrated by ${safeVoiceName}</li>`,
        note: `<li>${safeVoiceName}'s narration is only available for selected ${safeOwnerName} titles.</li>`,
      }
      : {
        leadIn: `<p>除了能解鎖書櫃的 AI 閱讀功能，還有隱藏版驚喜——切換 ${safeVoiceName} 的聲音來聽書！</p>`,
        bullet: `<li>獨家！${safeVoiceName} 聲線朗讀聽書</li>`,
        note: `<li>${safeVoiceName} 的朗讀功能僅適用於 ${safeOwnerName} 指定書目。</li>`,
      };
  }
  const plusPageURL = getPlusPageURL({
    language: lang,
    coupon: code,
    plan: 'monthly',
    trial: '0',
    from: fromLikerId ? `@${fromLikerId}` : undefined,
    utmCampaign: 'book-plus-promo',
    utmSource: 'book-promo',
    utmMedium: 'email',
  });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendPlusBookPromoCodeEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [email],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${subjectTitle}` : subjectTitle,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: htmlTitle,
              content1: `<p>Dear ${safeDisplayName || 'reader'},</p>
            <p>Thank you for purchasing ${safeBookNames.length > 1 ? 'the following ebooks from' : 'the following ebook from'} ${safeOwnerName}:</p>
            <ul>${safeBookNames.map((name) => `<li>"${name}"</li>`).join('')}</ul>
            <p>You have received our limited-time gift: <strong>1 month of 3ook.com Plus membership (worth ${monthlyPriceLabel})</strong>.</p>
            ${voice.leadIn}
            <p><strong>${safeOwnerName} exclusive · Plus member features</strong></p>
            <ul>
              ${voice.bullet}
              <li>Record your own voice to create a personal narrator</li>
              <li>20% off all books, no limit</li>
              <li>Dark mode and other exclusive features</li>
              <li>Yearly-exclusive gift: any ebook of your choice, every year</li>
            </ul>
            <p>⬇️ Click below to activate your Plus membership ⬇️</p>`,
              buttonText1: 'Claim my 1-month 3ook Plus membership',
              buttonHref1: plusPageURL,
              append1: `<p><strong>Subscription notes</strong></p>
            <ul>
              <li>Choose either an annual or monthly subscription — the system will automatically deduct one month's fee (${monthlyPriceLabel}).</li>
              <li>The next month will renew at the regular price; you can cancel anytime on the website.</li>
              <li>If the discount is not applied automatically, please enter the promo code manually: <strong>${code}</strong></li>
              ${voice.note}
            </ul>
            <p>If you have any questions, please contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a>.</p>
            <p>Thank you again for supporting ${safeOwnerName}'s books.<br>May you find more joy of reading between voice and text.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: htmlTitle,
              content1: `<p>親愛的 ${safeDisplayName || '讀者'}：</p>
            <p>謝謝您購買 ${safeOwnerName} 以下電子書：</p>
            <ul>${safeBookNames.map((name) => `<li>《${name}》</li>`).join('')}</ul>
            <p>您已獲得期間活動限定贈禮「<strong>3ook.com Plus 會員一個月（價值 ${monthlyPriceLabel}）</strong>」。</p>
            ${voice.leadIn}
            <p><strong>【${safeOwnerName} 獨家合作．Plus 會員功能】</strong></p>
            <ul>
              ${voice.bullet}
              <li>自行錄製聲線，打造專屬聲優</li>
              <li>全站購書八折 無上限</li>
              <li>專享深色模式等專屬功能</li>
              <li>年費會員限定禮：每年全站任選電子書乙本</li>
            </ul>
            <p>⬇️ 點擊開啟 Plus 會員資格 ⬇️</p>`,
              buttonText1: '領取我的 3ook Plus 會員資格一個月',
              buttonHref1: plusPageURL,
              append1: `<p><strong>【訂閱說明】</strong></p>
            <ul>
              <li>可依需求自由選擇年費、月費會員訂閱，系統將會自動折抵「一個月會員費用 ${monthlyPriceLabel}」。</li>
              <li>隔月系統將按原價續訂，可於網站內隨時取消。</li>
              <li>如未自動帶入折扣，請手動輸入優惠序號：<strong>${code}</strong></li>
              ${voice.note}
            </ul>
            <p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。</p>
            <p>再次謝謝您支持 ${safeOwnerName} 書籍，<br>願您能在聲音與文字間，發現更多閱讀的樂趣。</p>
            <p>3ook.com 書店 敬上</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendPlusGiftPendingClaimEmail({
  fromName,
  fromEmail,
  toName,
  toEmail,
  message,
  cartId,
  paymentId,
  claimToken,
  isResend = false,
  language = 'zh',
}) {
  const isEn = language === 'en';
  const lang = isEn ? 'en' : 'zh-Hant';
  const title = isEn
    ? `${isResend ? '(Reminder) ' : ''}${fromName} has gifted you a Plus membership`
    : `${isResend ? '（提示）' : ''}${fromName} 送贈了 Plus 會籍給你`;
  const claimPageURL = getPlusGiftPageClaimURL({
    cartId,
    paymentId,
    token: claimToken,
    language: lang,
    email: toEmail,
  });
  const ccAddresses: string[] = [];
  if (fromEmail) {
    ccAddresses.push(fromEmail);
  }
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendPlusGiftPendingClaimEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [toEmail],
      CcAddresses: ccAddresses,
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${toName || 'reader'},</p>
            <p>${fromName} has ${isResend ? 'previously ' : ''}gifted you a Plus membership.</p>
            <p>Please register at <a href="${claimPageURL}">3ook.com bookstore</a> to claim your membership and start your AI reading journey.</p>`,
              messageTitle1: `${fromName}'s message`,
              messageContent1: message,
              buttonText1: 'Claim my Plus membership',
              buttonHref1: claimPageURL,
              append1: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>May you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${toName || '讀者'}：</p>
            <p>${fromName} ${isResend ? '先前' : ''}送贈了 Plus 會籍給你。</p>
            <p>請在 <a href="${claimPageURL}">3ook.com 書店</a>註冊獲取會籍，開始你的 AI 閱讀之旅。</p>`,
              messageTitle1: `${fromName} 的留言`,
              messageContent1: message,
              buttonText1: '領取我的 Plus 會籍',
              buttonHref1: claimPageURL,
              append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}

export function sendPlusGiftClaimedEmail({
  fromEmail,
  fromName,
  toName,
  language = 'zh',
}) {
  const isEn = language === 'en';
  const title = isEn
    ? `${toName} has accepted your Plus membership gift`
    : `${toName} 已接受你送贈的 Plus 會籍`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendPlusGiftClaimedEmail',
      },
      {
        Name: 'Environment',
        Value: TEST_MODE ? 'testnet' : 'mainnet',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      ...(TEST_MODE ? {} : { BccAddresses: [SALES_EMAIL] }),
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: TEST_MODE ? `(TESTNET) ${title}` : title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: isEn
            ? getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>Dear ${fromName},</p>
            <p>Your Plus membership gift to ${toName} has been accepted.</p>
            <p>Thank you for sharing the joy of reading.</p>
            <p>3ook.com Bookstore</p>`,
            }).body
            : getNFTTwoContentWithMessageAndButtonTemplate({
              title1: title,
              content1: `<p>親愛的 ${fromName}：</p>
            <p>你送贈給 ${toName} 的 Plus 會籍已被接收。</p>
            <p>感謝你分享閱讀的樂趣</p>
            <p>3ook.com 書店</p>`,
            }).body,
        },
      },
    },
  };
  return ses.sendEmail(params);
}
