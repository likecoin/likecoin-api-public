/* eslint-disable no-underscore-dangle */
import { getBasicTemplate } from '@likecoin/edm';
import aws from 'aws-sdk';
import { NFT_BOOKSTORE_HOSTNAME, TEST_MODE } from '../constant';
import { getLikerLandNFTClaimPageURL, getLikerLandNFTClassPageURL } from './liker-land';

if (!TEST_MODE) aws.config.loadFromPath('config/aws.json');

const ses = new aws.SES();

export async function sendVerificationEmail(res, user, ref) {
  if (TEST_MODE) return Promise.resolve();
  const params = {
    Source: '"Liker Land" <noreply@liker.land>',
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
          Data: getBasicTemplate({
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
    Source: '"Liker Land" <noreply@liker.land>',
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
          Data: getBasicTemplate({
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
    Source: '"Liker Land" <noreply@liker.land>',
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
          Data: getBasicTemplate({
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
  classId,
  className,
  wallet,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '你的 Writing NFT 已送達 | Your Writing NFT has arrived';
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const params = {
    Source: '"Liker Land" <team@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendAutoClaimEmail',
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
          Data: getBasicTemplate({
            title,
            content: `<p>親愛的 Liker：</p>
            <p>感謝購買 《<a href="${nftClassURLZh}">${className}</a>》的 Writing NFT。</p>
            <p>你的信箱先前已與地址為 ${wallet} 的錢包完成驗證，你所購買的 Writing NFT 已發送至該錢包。</p>
            <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land 客服</a>。</p>
            <p>感謝支持創作。</p>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear Liker,</p>
            <p>Thank you for purchasing the Writing NFT of "<a href="${nftClassURLEn}">${className}</a>".</p>
            <p>Your email is previously linked with the wallet address ${wallet}, the Writing NFT you purchased has been sent to the wallet.</p>
            <p>If you encounter any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land customer service</a>.</p>
            <p>Thank you for supporting creativity.</p>
            <p>Liker Land</p>`
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendPendingClaimEmail({
  email,
  classId,
  className,
  paymentId,
  claimToken,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '領取你的 Writing NFT | Claim your Writing NFT';
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const claimURLEn = getLikerLandNFTClaimPageURL({
    classId,
    paymentId,
    token: claimToken,
    language: 'en',
  });
  const claimURLZh = getLikerLandNFTClaimPageURL({
    classId,
    paymentId,
    token: claimToken,
    language: 'zh-Hant',
  });
  const params = {
    Source: '"Liker Land" <team@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendPendingClaimEmail',
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
          Data: getBasicTemplate({
            title,
            content: `<p>親愛的讀者：</p>
            <p>感謝購買 《<a href="${nftClassURLZh}">${className}</a>》。</p>
            <p>請完成以下兩個簡單步驟，以領取作品的 Writing NFT：</p>
            <p>1. 連接錢包</p>
            <p>2. 驗證電郵地址</p>
            <br/>
            <p><b>步驟一：連接錢包</b></p>
            <p>先在 Chrome 瀏覽器安裝 Keplr 錢包，請參考以下教學影片：</p>
            <p><a href="https://youtu.be/WQGW1P0KgOA">如何安裝 Keplr 及使用 LikeCoin （國語）</a></p>
            <p><a href="https://youtu.be/oOC7jjHI5_g">如何安裝 Keplr 及使用 LikeCoin （廣東話）</a></p>
            <p>若你已安裝 Keplr 錢包，可跳過此步驟。</p>
            <br/>
            <p><b>步驟二：驗證電郵地址</b></p>
            <p>1. 點擊此<a href="${claimURLZh}">驗證電郵連結</a>，點選「連接錢包」按鈕，再點選彈出視窗的「Keplr」選項。</p>
            <p>2. 點擊 Keplr 彈出視窗的「Approve」按鈕，進行簽署，完成連接錢包。</p>
            <p>3. 信箱設定頁面已預設你的信箱地址，請點選「確認」按鈕，系統將寄出驗證電郵到你的信箱。</p>
            <p>4. 點選驗證電郵的連結完成驗證。</p>
            <br/>
            <p>完成以上兩步驟後，系統將把你購買的 Writing NFT 發送給你。你可以到 Liker Land 的「我的書架」查看。</p>
            <br/>
            <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land 客服</a>。</p>
            <p>感謝支持創作。</p>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear reader,</p>
            <p>Thank you for purchasing "<a href="${nftClassURLEn}">${className}</a>".</p>
            <p>Please complete the following two simple steps to receive the Writing NFT:</p>
            <p>1. Connect your wallet.</p>
            <p>2. Verify your email address.</p>
            <br/>
            <p><b>Step 1: Connect your wallet</b></p>
            <p>First, install the Keplr wallet on your Chrome browser. Please refer to <a href="https://docs.like.co/general-guides/wallet/keplr">this tutorial</a>.</p>
            <p>If you have already installed the Keplr wallet, you can skip this step.</p>
            <br/>
            <p><b>Step 2. Verify your email address</b></p>
            <p>After installing Keplr on your browser:</p>
            <p>1. Click on this <a href="${claimURLEn}">email verification link</a>, then click the "Connect Wallet" button and select "Keplr" from the pop-up window.</p>
            <p>2. Click the "Approve" button on the Keplr pop-up window to sign and complete the wallet connection.</p>
            <p>3. Your email address has been pre-set in the mailbox settings page. Click the "Confirm" button, and the system will send a verification email to your inbox.</p>
            <p>4. Click on the verification link in the email to complete the verification process.</p>
            <br/>
            <p>After completing the above two steps, the system will send the Writing NFT you purchased to you. You can check it in "My Dashboard" on Liker Land.</p>
            <br/>
            <p>If you have any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land Customer Service</a>.</p>
            <p>Thank you for supporting creativity.</p>
            <p>Liker Land</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookPendingClaimEmail({
  email,
  classId,
  className,
  paymentId,
  claimToken,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '領取你的 NFT 書 | Claim your NFT Book';
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    classId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    classId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
  });
  const params = {
    Source: '"Liker Land" <team@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['operations@liker.land'],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicTemplate({
            title,
            content: `<p>親愛的讀者：</p>
            <br/>
            <p>感謝支持並購買 <a href="${nftClassURLZh}">《${className}》</a>。</p>
            <p>請根據以下兩步驟領取你的 NFT 書：</p>
            <p>1. 確認您已有 Keplr 密碼貨幣錢包；如尚未持有，請參考<a href="https://youtu.be/bPaZk-ehWrg">此教學影片</a>（廣東話版教學影片<a href="https://youtu.be/RC8PugjnZq8">另見此連結</a>），或參考<a href="https://docs.like.co/v/zh/general-guides/wallet/keplr/how-to-install-keplr-extension">圖文教學</a>。</p>
            <p>2. 前往 Liker Land 的<a href="${claimPageURLZh}">認領頁面</a>，連結錢包以驗證領取資格。</p>
            <p>完成以上步驟後，作者會在 1-3 個工作天內親手簽發 NFT 書。請往你的 Liker Land 書架查閱。</p>
            <p>如有任何疑問，歡迎<a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">聯絡客服</a>查詢。</p>
            <p>感謝珍藏此 NFT 書，願你享受閱讀的樂趣。</p>
            <br/>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear reader,</p>
            <br/>
            <p>Thank you for your support and purchasing "<a href="${nftClassURLEn}">${className}</a>".</p>
            <p>Please follow the two steps below to claim your NFT book:</p>
            <p>1. Ensure that you have the Keplr wallet installed. If you don't have one yet, please refer to this tutorial video (<a href="https://youtu.be/bPaZk-ehWrg">Mandarin version</a>, <a href="https://youtu.be/RC8PugjnZq8">Cantonese version</a>), or refer to <a href="https://docs.like.co/v/zh/general-guides/wallet/keplr/how-to-install-keplr-extension">this step-by-step guide</a> with illustrations.</p>
            <p>2. Visit the <a href="${claimPageURLEn}">claim page</a> on Liker Land and connect your wallet to verify your eligibility.</p>
            <p>Once these steps are completed, the author will issue the NFT book to you within 1-3 business days. Please check your Liker Land bookshelf for the book.</p>
            <p>If you have any questions, please feel free to contact our <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">customer service</a> for assistance.</p>
            <p>Thank you for cherishing this NFT book, and may you enjoy the pleasure of reading.</p>
            <br/>
            <p>Liker Land</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookSalesEmail({
  emails,
  buyerEmail,
  className,
  amount,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `You have sold an NFT for $${amount}`;
  const params = {
    Source: '"Liker Land" <team@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookSalesEmail',
      },
    ],
    Destination: {
      ToAddresses: emails,
      BccAddresses: ['operations@liker.land'],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicTemplate({
            title,
            content: `<p>Dear Creator,</p>
            <br/>
            <p>Congratulation!</p>
            <p>${buyerEmail} has bought your NFT book ${className} for $${amount}.</p>
            <p>Please deliver the book after the user has verified their wallet address. You will get another notification when they have done.</p>
            <br/>
            <p>Liker Land</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookClaimedEmail({
  emails, classId, className, paymentId, wallet, message, buyerEmail,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `A user has claimed an NFT book ${className}`;
  const params = {
    Source: '"Liker Land" <team@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookClaimedEmail',
      },
    ],
    Destination: {
      ToAddresses: emails,
      BccAddresses: ['operations@liker.land'],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: getBasicTemplate({
            title,
            content: `<p>Dear Creator,</p>
            <br/>
            <p>Congratulation. A reader has claimed your NFT book${message ? ` with message: "${message}"` : ''}.</p>
            <p>Reader email: ${buyerEmail}</p>
            <p>Reader wallet address: ${wallet}</p>
            <p>Please visit the <a href="https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/send/${classId}/?payment_id=${paymentId}">NFT book management page</a> to deliver your book.</p>
            <br>
            <p>Liker Land</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}
