/* eslint-disable no-underscore-dangle */
import { getBasicV2Template, getNFTTwoContentWithMessageAndButtonTemplate } from '@likecoin/edm';
import aws from 'aws-sdk';
import {
  TEST_MODE,
  CUSTOMER_SERVICE_URL,
  CUSTOMER_SERVICE_EMAIL,
  SALES_EMAIL,
  SYSTEM_EMAIL,
} from '../constant';
import {
  getLikerLandNFTClaimPageURL,
  getLikerLandNFTClassPageURL,
  getLikerLandNFTCollectionPageURL,
  getLikerLandPortfolioPageURL,
} from './liker-land';
import {
  getNFTBookStoreClassPageURL,
  getNFTBookStoreCollectionPageURL,
  getNFTBookStoreCollectionSendPageURL,
  getNFTBookStoreSendPageURL,
} from './api/likernft/book';
import { fetchUserDisplayNameByEmail } from './api/users';

if (!TEST_MODE) aws.config.loadFromPath('config/aws.json');

const ses = new aws.SES();

export async function sendVerificationEmail(res, user, ref) {
  if (TEST_MODE) return Promise.resolve();
  const params = {
    Source: SYSTEM_EMAIL,
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendVerificationEmail',
      },
    ],
    Destination: {
      ToAddresses: [user.email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: res.__('Email.VerifiyEmail.subject'),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title: res.__('Email.VerifiyEmail.subject'),
            content: res.__('Email.VerifiyEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              ref,
            }) + res.__('Email.signature'),
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendVerificationWithCouponEmail(res, user, coupon, ref) {
  if (TEST_MODE) return Promise.resolve();
  const params = {
    Source: SYSTEM_EMAIL,
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendVerificationWithCouponEmail',
      },
    ],
    Destination: {
      ToAddresses: [user.email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: res.__('Email.VerifiyAndCouponEmail.subject'),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title: res.__('Email.VerifiyAndCouponEmail.subject'),
            content: res.__('Email.VerifiyAndCouponEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              coupon,
              ref,
            }) + res.__('Email.signature'),
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendInvitationEmail(res, { email, referrerId, referrer }) {
  if (TEST_MODE) return Promise.resolve();
  const title = res.__('Email.InvitationEmail.subject', { referrer });
  const params = {
    Source: SYSTEM_EMAIL,
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendInvitationEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content: res.__('Email.InvitationEmail.body', {
              referrerId,
              referrer,
              email,
            }) + res.__('Email.signature'),
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendAutoClaimEmail({
  email,
  classIds,
  firstClassName,
  wallet,
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = 'Your Writing NFT has arrived';
  const titleZh = '你的 Writing NFT 已送達';
  const firstClassId = classIds[0];
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'zh-Hant' });
  const pluralDescriptionZh = classIds.length > 1 ? `等 ${classIds.length} 個作品` : '';
  const pluralDescriptionEn = classIds.length > 1 ? ` and ${classIds.length - 1} other work${classIds.length > 2 ? 's' : ''}` : '';
  const portfolioURLEn = getLikerLandPortfolioPageURL({ type: 'writing_nft', language: 'en' });
  const portfolioURLZh = getLikerLandPortfolioPageURL({ type: 'writing_nft', language: 'zh-Hant' });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendAutoClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的讀者：</p>
            <p>感謝購買 《<a href="${nftClassURLZh}">${firstClassName}</a>》${pluralDescriptionZh}。</p>
            <p>你的信箱先前已與地址為 ${wallet} 的錢包完成驗證，你所購買的 Writing NFT 已發送至該錢包。
            <br>請往你的 <a href="${portfolioURLZh}">3ook.com 書店的個人主頁</a>查閱。</p>
            <p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝支持創作。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear reader,</p>
            <p>Thank you for purchasing "<a href="${nftClassURLEn}">${firstClassName}</a>"${pluralDescriptionEn}.</p>
            <p>Your email is previously linked with the wallet address ${wallet},
            the Writing NFT you purchased has been sent to the wallet.</p>
            You can check the status of the Writing NFT on your <a href="${portfolioURLEn}">Dashboard on 3ook.com bookstore</a>.</p>
            <p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for supporting creativity.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendPendingClaimEmail({
  email,
  classIds,
  firstClassName,
  paymentId,
  claimToken,
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleZh = '領取你的 Writing NFT';
  const titleEn = 'Claim your Writing NFT';
  const firstClassId = classIds[0];
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'zh-Hant' });
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    classId: firstClassId,
    paymentId,
    token: claimToken,
    language: 'en',
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    classId: firstClassId,
    paymentId,
    token: claimToken,
    language: 'zh-Hant',
  });
  const pluralDescriptionZh = classIds.length > 1 ? `等 ${classIds.length} 個作品` : '';
  const pluralDescriptionEn = classIds.length > 1 ? ` and ${classIds.length - 1} other work${classIds.length > 2 ? 's' : ''}` : '';
  const portfolioURLEn = getLikerLandPortfolioPageURL({ type: 'writing_nft', language: 'en' });
  const portfolioURLZh = getLikerLandPortfolioPageURL({ type: 'writing_nft', language: 'zh-Hant' });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的讀者：</p>
            <p>感謝購買 《<a href="${nftClassURLZh}">${firstClassName}</a>》${pluralDescriptionZh}。</p>
            <p>請根據網頁指示領取你的 Writing NFT，亦可按以下連結前往該頁面。
            完成步驟後，即可領取 Writing NFT。
            屆時請往你的 <a href="${portfolioURLZh}">3ook.com 書店的個人主頁</a>查閱。</p>`,
            buttonText1: '領取我的 Writing NFT',
            buttonHref1: claimPageURLZh,
            append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝支持創作。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear reader,</p>
            <p>Thank you for purchasing "<a href="${nftClassURLEn}">${firstClassName}</a>"${pluralDescriptionEn}.</p>
            <p>Please follow the steps on the web to claim your Writing NFT.
            You can also click the button below to get a direct link to that page.
            Once the steps are completed, you can receive your Writing NFT.
            You can check the status of the Writing NFT on your <a href="${portfolioURLEn}">Dashboard on 3ook.com bookstore</a>.</p>`,
            buttonText2: 'Claim your Writing NFT',
            buttonHref2: claimPageURLEn,
            append2: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for supporting creativity.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookListingEmail({
  classId = '',
  collectionId = '',
  bookName,
  site,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `New NFT Book listing: ${bookName}`;
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId })
    : getLikerLandNFTClassPageURL({ classId, site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookListingEmail',
      },
    ],
    Destination: {
      ToAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
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
  return ses.sendEmail(params).promise();
}

export async function sendNFTBookPendingClaimEmail({
  email,
  classId = '',
  collectionId = '',
  bookName,
  paymentId,
  claimToken,
  from = '',
  isResend = false,
  site = undefined,
}) {
  if (TEST_MODE) return Promise.resolve();

  let receiverDisplayName = '';
  try {
    receiverDisplayName = await fetchUserDisplayNameByEmail(email);
  } catch {
    // Do nothing
  }
  const titleEn = `${isResend ? '(Reminder) ' : ''}Read your ebook`;
  const titleZh = `${isResend ? '（提示）' : ''}閱讀你的電子書`;
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en', site });

  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant', site });
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
    site,
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
    site,
  });
  const portfolioURLEn = getLikerLandPortfolioPageURL({ language: 'en', site });
  const portfolioURLZh = getLikerLandPortfolioPageURL({ language: 'zh-Hant', site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的${receiverDisplayName || '讀者'}：</p>
            <p>感謝你${isResend ? '先前' : ''}購買<a href="${nftPageURLZh}">《${bookName}》</a>。</p>
            <p>請在 3ook.com 書店，到「<a href="${claimPageURLZh}">我的書架</a>」閱讀你的電子書。
            若你未註冊 3ook.com 帳號，請點擊<a href="${claimPageURLZh}">這裡</a>註冊。</p>
            <p>若你購買的電子書需要作者親自簽發，請先點擊<a href="${claimPageURLZh}">這裡</a>登入 3ook.com 書店登記，然後耐心等待作者的發貨通知。
            作者會在 1-3 個工作天內親手簽發你的電子書。
            屆時請往你的 <a href="${portfolioURLZh}">3ook.com 書店的書架</a>查閱。</p>`,
            buttonText1: titleZh,
            buttonHref1: claimPageURLZh,
            append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>
            <p>[${from}]</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear ${receiverDisplayName || 'reader'},</p>
            <p>Thanks for ${isResend ? 'previously' : ''} purchasing "<a href="${nftPageURLEn}">${bookName}</a>".</p>
            <p>Please <a href="${claimPageURLEn}">login to Bookshelf on 3ook.com bookstore</a> to read your ebook.
            If you have not registered an account on 3ook.com bookstore, please <a href="${claimPageURLEn}">click here</a> to register.</p>
            <p>If the ebook you purchased requires the author's personal signature,
            please first log in to 3ook.com bookstore and register by clicking <a href="${claimPageURLEn}">here</a>, and then patiently wait for the author's dispatch notification.
            The author will personally sign your ebook within 1-3 business days.
            Please check your <a href="${portfolioURLEn}">Bookshelf on 3ook.com bookstore</a> at that time.</p>`,
            buttonText2: titleEn,
            buttonHref2: claimPageURLEn,
            append2: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>
            <p>[${from}]</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendNFTBookCartPendingClaimEmail({
  email,
  cartId,
  bookNames,
  paymentId,
  claimToken,
  isResend = false,
  site,
}) {
  if (TEST_MODE) return Promise.resolve();
  let receiverDisplayName = '';
  try {
    receiverDisplayName = await fetchUserDisplayNameByEmail(email);
  } catch {
    // Do nothing
  }
  const titleEn = `${isResend ? '(Reminder) ' : ''}Read your ebook`;
  const titleZh = `${isResend ? '（提示）' : ''}閱讀你的電子書`;
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
    site,
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
    site,
  });
  const portfolioURLEn = getLikerLandPortfolioPageURL({ language: 'en', site });
  const portfolioURLZh = getLikerLandPortfolioPageURL({ language: 'zh-Hant', site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookCartPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [SALES_EMAIL], // send to SALES_EMAIL instead of email before revamp
      // BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的${receiverDisplayName || '讀者'}：</p>
            <p>感謝${isResend ? '你先前' : ''}購買以下電子書</p>
            <ul>${bookNames.map((name) => `<li>《${name}》</li>`).join('')}</ul>
            <p>請在 3ook.com 書店，到「<a href="${claimPageURLZh}">我的書架</a>」閱讀你的電子書。
            若你未註冊 3ook.com 帳號，請點擊<a href="${claimPageURLZh}">這裡</a>註冊。</p>
            <p>若你購買的電子書需要作者親自簽發，請先點擊<a href="${claimPageURLZh}">這裡</a>登入 3ook.com 書店登記，然後耐心等待作者的發貨通知。
            作者會在 1-3 個工作天內親手簽發你的電子書。
            屆時請往你的 <a href="${portfolioURLZh}">3ook.com 書店的書架</a>查閱。</p>`,
            buttonText1: titleZh,
            buttonHref1: claimPageURLZh,
            append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear ${receiverDisplayName || 'reader'},</p>
            <p>Thank you for ${isResend ? 'previously' : ''}purchasing the following ebook</p>
            <ul>${bookNames.map((name) => `<li>"${name}"</li>`).join('')}</ul>
            <p>Please <a href="${claimPageURLEn}">login to Bookshelf on 3ook.com bookstore</a> to read your ebook.
            If you have not registered an account on 3ook.com bookstore, please <a href="${claimPageURLEn}">click here</a> to register.</p>
            <p>If the ebook you purchased requires the author's personal signature,
            please log in to 3ook.com bookstore and register by clicking <a href="${claimPageURLEn}">here</a>, and then patiently wait for the author's dispatch notification.
            The author will personally sign your ebook within 1-3 business days.
            Please check your <a href="${portfolioURLEn}">Bookshelf on 3ook.com bookstore</a> at that time.</p>`,
            buttonText2: titleEn,
            buttonHref2: claimPageURLEn,
            append2: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookPhysicalOnlyEmail({
  email,
  classId = '',
  collectionId = '',
  bookName,
  priceName = '',
  site = '',
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = 'Thank you for your purchase!';
  const titleZh = '購買成功';
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en', site });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant', site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的讀者：</p>
            <p>感謝購買<a href="${nftPageURLZh}">《${bookName}》- ${priceName}</a>。
            <br>我們會安排寄送，所需大約 3-5 天時間。感謝支持！</p>
            <p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear reader,</p>
            <p>Thank you for your support and purchasing "<a href="${nftPageURLEn}">"${bookName}"- ${priceName}</a>".
            <br>We will arrange delivery, which will take about 3-5 days. Thank you for your support!</p>
            <p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

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
  isResend = false,
  site = undefined,
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = `${isResend ? '(Reminder) ' : ''} ${fromName} has sent you an ebook gift from 3ook.com`;
  const titleZh = `${isResend ? '（提示）' : ''} ${fromName} 送了一本電子書禮物給你`;
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en', site });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant', site });
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
    site,
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
    site,
  });
  const portfolioURLEn = getLikerLandPortfolioPageURL({ language: 'en', site });
  const portfolioURLZh = getLikerLandPortfolioPageURL({ language: 'zh-Hant', site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [toEmail],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的 ${toName}：</p>
            <p>${fromName} ${isResend ? '先前' : ''}贈送了一本 <a href="${nftPageURLZh}">《${bookName}》</a> 電子書給你作為禮物。</p>
            <p>請根據網頁指示領取你的電子書，亦可按以下連結前往該頁面。完成步驟後，即可領取電子書。</p>
            <p>若你收到的電子書需要作者親自簽發，請在完成步驟後，耐心等待作者發貨。
            作者會在 1-3 個工作天內親手簽發你的電子書。
            屆時請往你的 <a href="${portfolioURLZh}">3ook.com 書店的個人主頁</a>查閱。</p>`,
            messageTitle1: `${fromName} 的留言`,
            messageContent1: message,
            buttonText1: '領取我的電子書',
            buttonHref1: claimPageURLZh,
            append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear reader,</p>
            <p>${fromName} has ${isResend ? 'previously' : ''} sent an ebook <a href="${nftPageURLEn}">“${bookName}“</a>” to you as a gift.</p>
            <p>Please follow the steps on the web to claim your ebook.
            You can also click the button below to get a direct link to that page.
            Once the steps are completed, you can receive your ebook.</p>
            <p>If the ebook you received requires a personal signature from the author,
            please wait patiently for the author to dispatch it after completing the steps,
            typically within 3 days. You can check the status of the ebook on your <a href="${portfolioURLEn}">Dashboard on 3ook.com bookstore</a>.</p>`,
            messageTitle2: `${fromName}'s message`,
            messageContent2: message,
            buttonText2: 'Claim your ebook',
            buttonHref2: claimPageURLEn,
            append2: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
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
  site,
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = `${isResend ? '(Reminder) ' : ''}${fromName} has sent you an ebook gift from 3ook.com`;
  const titleZh = `${isResend ? '（提示）' : ''}${fromName} 送了電子書禮物給你`;
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
    site,
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
    site,
  });
  const portfolioURLEn = getLikerLandPortfolioPageURL({ language: 'en', site });
  const portfolioURLZh = getLikerLandPortfolioPageURL({ language: 'zh-Hant', site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookCartGiftPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [toEmail],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的 ${toName || '讀者'}：</p>
            <p>${fromName} ${isResend ? '先前' : ''}贈送了以下電子書給你作為禮物。</p>
            <ul>${bookNames.map((name) => `<li>《${name}》</li>`).join('')}</ul>
            <p>請在 3ook.com 書店，到「<a href="${claimPageURLZh}">我的書架</a>」閱讀你的電子書。
            若你未註冊 3ook.com 帳號，請點擊<a href="${claimPageURLZh}">這裡</a>註冊。</p>
            <p>若你購買的電子書需要作者親自簽發，請先點擊<a href="${claimPageURLZh}">這裡</a>登入 3ook.com 書店登記，然後耐心等待作者的發貨通知。
            作者會在 1-3 個工作天內親手簽發你的電子書。
            屆時請往你的 <a href="${portfolioURLZh}">3ook.com 書店的書架</a>查閱。</p>`,
            messageTitle1: `${fromName} 的留言`,
            messageContent1: message,
            buttonText1: '領取我的電子書',
            buttonHref1: claimPageURLZh,
            append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear ${toName || 'reader'},</p>
            <p>${fromName} has ${isResend ? 'preivously' : ''} sent the following ebooks to you as a gift.</p>
            <ul>${bookNames.map((name) => `<li>"${name}"</li>`).join('')}</ul>
            <p>Please <a href="${claimPageURLEn}">login to Bookshelf on 3ook.com bookstore</a> to read your ebook.
            If you have not registered an account on 3ook.com bookstore, please <a href="${claimPageURLEn}">click here</a> to register.</p>
            <p>If the ebook you purchased requires the author's personal signature,
            please log in to 3ook.com bookstore and register by clicking <a href="${claimPageURLEn}">here</a>, and then patiently wait for the author's dispatch notification.
            The author will personally sign your ebook within 1-3 business days.
            Please check your <a href="${portfolioURLEn}">Bookshelf on 3ook.com bookstore</a> at that time.</p>`,
            messageTitle2: `${fromName}'s message`,
            messageContent2: message,
            buttonText2: 'Claim your ebook',
            buttonHref2: claimPageURLEn,
            append2: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookShippedEmail({
  email,
  classId = '',
  collectionId = '',
  bookName,
  message,
  site,
}: {
  email: string;
  classId?: string;
  collectionId?: string;
  bookName: string;
  message: string;
  site?: string;
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = 'Your NFT Book physical merch has been shipped';
  const titleZh = '你的 NFT 書實體商品已發送';
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en', site });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant', site });
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookShippedEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的讀者：</p>
            <p>感謝購買<a href="${nftPageURLZh}">《${bookName}》</a>。
            <br>你的實體商品已發送，以下是作者提供的資訊：</p>`,
            messageContent1: message,
            append1: `<p>如有任何疑問，歡迎<a href="${CUSTOMER_SERVICE_URL}">聯絡客服</a>查詢。
            <br>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear reader,</p>
            <p>Thank you for your support and purchasing "<a href="${nftPageURLEn}">"${bookName}"</a>".
            <br>The physical merchanise that come with your book has been shipped,
            following is the message provided by author.</p>`,
            messageContent2: message,
            append2: `<p>If you have any questions, please feel free to contact our <a href="${CUSTOMER_SERVICE_URL}">Customer Service</a> for assistance.
            <br>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookGiftClaimedEmail({
  bookName,
  fromEmail,
  fromName,
  toName,
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = `${toName} has accepted your ebook gift ${bookName}`;
  const titleZh = `${toName} 已接受你的禮物電子書 ${bookName}`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftClaimedEmail',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的 ${fromName}：</p>
            <p>你送給 ${toName} 的《${bookName}》已被接受。
            <br>作者將會在稍後簽署給發送電子書給 ${toName} </p>
            <p>感謝你分享閱讀的樂趣</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear ${fromName},</p>
            <p>Your ebook gift of ${bookName} has been accepted by ${toName}.
            <br>Author will soon sign and send the ebook copy to ${toName}</p>
            <p>Thank you for sharing the joy of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookGiftSentEmail({
  fromEmail,
  fromName,
  toName,
  bookName,
  txHash,
}) {
  if (TEST_MODE) return Promise.resolve();
  const titleEn = `Your ebook gift ${bookName} to ${toName} has been delivered`;
  const titleZh = `你給 ${toName} 的禮物電子書 ${bookName} 已經發送`;
  const txURL = `https://mintscan.com/likecoin/txs/${txHash}`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftSentEmail',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: [titleZh, titleEn].join(' | '),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getNFTTwoContentWithMessageAndButtonTemplate({
            title1: titleZh,
            content1: `<p>親愛的 ${fromName}：</p>
            <p>你購買的 ${bookName} 已成功發送給 ${toName}。
            <br>如需瀏覽技術細節，請按<a href="${txURL}">此連結</a></p>
            <p>感謝你分享閱讀的樂趣</p>
            <p>3ook.com 書店</p>`,

            // English version
            title2: titleEn,
            content2: `<p>Dear ${fromName},</p>
            <p>Your gift ${bookName} has been delivered to ${toName}.
            <br>For technical details, visit <a href="${txURL}">transaction detail page</a></p>
            <p>Thank you for sharing the joy of reading.</p>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

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
  phone,
  shippingDetails,
  shippingCostAmount = 0,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `You have sold a Book for $${amount}`;
  let content = `<p>Dear Creator,</p>
  <br/>
  <p>Congratulation!</p>
  <p>${buyerEmail} has bought your book ${bookName} for $${amount}${isGift ? ` as a gift to ${giftToName}<${giftToEmail}>` : ''}.</p>`;
  const hasTipping = amount > (originalPrice * quantity);
  content += `<p>Price: $${originalPrice} x ${quantity}</p>`;
  if (hasTipping) {
    content += `<p>Tip: $${amount - originalPrice * quantity - shippingCostAmount}</p>`;
  }
  if (shippingCostAmount) {
    content += `<p>Shipping paid: $${shippingCostAmount}</p>`;
  }
  if (shippingDetails) {
    content += `<p>Shipping details: <pre>
${shippingDetails.name}
${['line1', 'line2', 'city', 'state', 'country', 'postal_code']
    .map((key) => shippingDetails.address[key])
    .filter(Boolean)
    .join(',\n')
}
</pre></p>`;
    content += `<p>Phone: ${phone}</p>`;
  }
  content += `<p>Please deliver the book after the user has verified their wallet address. You will get another notification when they have done so.</p>
  <br/>
  <p>3ook.com Bookstore</p>`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookSalesEmail',
      },
    ],
    Destination: {
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
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
  if (emails && emails.length > 0) {
    (params.Destination as any).ToAddresses = emails;
  }
  return ses.sendEmail(params).promise();
}

export function sendNFTBookSalePaymentsEmail({
  classId = '',
  collectionId = '',
  paymentId,
  email,
  bookName,
  payments,
  site,
}) {
  if (TEST_MODE) return Promise.resolve();
  const hasRoyalty = payments.some(({ type }) => type === 'connectedWallet');
  const totalAmount = payments.reduce((acc, { amount }) => acc + amount, 0);
  const displayPayments = payments.map(({ amount, type }) => {
    const roundedCurrency = `US$${amount.toFixed(2)}`;
    switch (type) {
      case 'connectedWallet':
        return `Royalty: ${roundedCurrency}`;
      case 'channelCommission':
        return `Commission: ${roundedCurrency}`;
      case 'shipping':
        return `Shipping: ${roundedCurrency}`;
      default:
        return `Unknown: ${roundedCurrency}`;
    }
  });
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId })
    : getLikerLandNFTClassPageURL({ classId, site });
  const title = `You received US$${totalAmount.toFixed(2)} for ${hasRoyalty ? 'selling' : 'helping to sell'} "${bookName}"`;
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookSalePaymentsEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content: `<p>Dear Book lover,</p>
            <br/>
            <p>Congratulation!</p>
            <p>Someone has bought the NFT book <a href="${nftPageURLEn}">${bookName}</a></p>
            <p>As a result, you received follow payments: </p>
            <ul>${displayPayments.map((payment) => `<li>${payment}</li>`).join('')}</ul>
            <p>Ref ID: ${paymentId}.</p>
            <br/>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookClaimedEmail({
  emails, classId = '', collectionId = '', bookName, paymentId, wallet, message, claimerEmail,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `A user has claimed an ebook ${bookName}`;
  const url = collectionId
    ? getNFTBookStoreCollectionSendPageURL(collectionId, paymentId)
    : getNFTBookStoreSendPageURL(classId, paymentId);
  const params = {
    Source: SYSTEM_EMAIL,
    ReplyToAddresses: [CUSTOMER_SERVICE_EMAIL],
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookClaimedEmail',
      },
    ],
    Destination: {
      ToAddresses: emails,
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicV2Template({
            title,
            content: `<p>Dear Creator,</p>
            <br/>
            <p>Congratulation. A reader has claimed your ebook${message ? ` with message: "${message}"` : ''}.</p>
            <p>Reader email: ${claimerEmail}</p>
            <p>Reader wallet address: ${wallet}</p>
            <p>Please visit the <a href="${url}">NFT book management page</a> to deliver your book.</p>
            <br>
            <p>3ook.com Bookstore</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookOutOfStockEmail({
  emails,
  classId = '',
  collectionId = '',
  bookName,
  priceName,
}) {
  if (TEST_MODE) return Promise.resolve();
  if (!emails.length) return Promise.resolve();
  const title = `Your book ${bookName} ${priceName} is sold out`;
  const url = collectionId
    ? getNFTBookStoreCollectionPageURL(collectionId)
    : getNFTBookStoreClassPageURL(classId);
  const content = `<p>Dear Creator,</p>
  <br/>
  <p>Congratulation!</p>
  <p>Your book ${bookName} ${priceName} is sold out.</p>
  <p>Please <a href="${url}">restock your book</a> to continue selling.</p>
  <br/>
  <p>3ook.com Bookstore</p>`;
  const params = {
    Source: SYSTEM_EMAIL,
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookOutOfStockEmail',
      },
    ],
    Destination: {
      BccAddresses: [SALES_EMAIL],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
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
  if (emails && emails.length > 0) {
    (params.Destination as any).ToAddresses = emails;
  }
  return ses.sendEmail(params).promise();
}
