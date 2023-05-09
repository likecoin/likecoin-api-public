/* eslint-disable no-underscore-dangle */
import EmailTemplate from '@likecoin/likecoin-email-templates';
import aws from 'aws-sdk';
import { LIKER_LAND_HOSTNAME, NFT_BOOKSTORE_HOSTNAME, TEST_MODE } from '../constant';

if (!TEST_MODE) aws.config.loadFromPath('config/aws.json');

const ses = new aws.SES();

export async function sendVerificationEmail(res, user, ref) {
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
          Data: EmailTemplate.Basic({
            title: res.__('Email.VerifiyEmail.subject'),
            body: res.__('Email.VerifiyEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              ref,
            }) + res.__('Email.signature'),
          }),
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendVerificationWithCouponEmail(res, user, coupon, ref) {
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
          Data: EmailTemplate.Basic({
            title: res.__('Email.VerifiyAndCouponEmail.subject'),
            body: res.__('Email.VerifiyAndCouponEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              coupon,
              ref,
            }) + res.__('Email.signature'),
          }),
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendInvitationEmail(res, { email, referrerId, referrer }) {
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
          Data: EmailTemplate.Basic({
            title,
            body: res.__('Email.InvitationEmail.body', {
              referrerId,
              referrer,
              email,
            }) + res.__('Email.signature'),
          }),
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
        Data: '你的 Writing NFT 已送達 | Your Writing NFT has arrived',
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
          <p>親愛的 Liker：</p>
          <p>感謝購買 《<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>》的 Writing NFT。</p>
          <p>你的信箱先前已與地址為 ${wallet} 的錢包完成驗證，你所購買的 Writing NFT 已發送至該錢包。</p>
          <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
              Land 客服</a>。</p>
          <p>感謝支持創作。</p>
          <p>Liker Land</p>
          <br/>
          <br/>
          <p>Dear Liker,</p>
          <p>Thank you for purchasing the Writing NFT of "<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>".</p>
          <p>Your email is previously linked with the wallet address ${wallet}, the Writing NFT you purchased has been sent to the wallet.</p>
          <p>If you encounter any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
            Land customer service</a>.</p>
          <p>Thank you for supporting creativity.</p>
          <p>Liker Land</p>
          `,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendPendingClaimEmail(email: string, classId: string, className: string) {
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
        Data: '領取你的 Writing NFT | Claim your Writing NFT',
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
          <p>親愛的 Liker：</p>
          <p>感謝購買 《<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>》的 Writing NFT，我們需要你提供 LikeCoin 錢包地址以把 Writing NFT 發送給你。</p>
          <p><strong>方法一：登入你的 Liker ID</strong></p>
          <p>你可隨時以 Liker Land 手機應用程式，以社交帳號方式登入後，檢查自己的 LikeCoin 錢包地址。</p>
          <p><strong>方法二：安裝 Keplr</strong></p>
          <p>若你想用新的 LikeCoin 地址接收 Writing NFT，可參看以下步驟，在 Chrome 瀏覽器安裝 Keplr 錢包。</p>
          <p><a href="https://youtu.be/WQGW1P0KgOA">如何安裝 Keplr 及使用 LikeCoin （國語）</a></p>
          <p><a href="https://youtu.be/oOC7jjHI5_g">如何安裝 Keplr 及使用 LikeCoin （廣東話）</a></p>
          <p>完成安裝後，你將可以在 <a href="https://liker.land/">Liker Land 網站</a>查看自己的 Writing NFT 珍藏。</p>
          <p>＋＋＋＋</p>
          <p>請回覆這電郵把 LikeCoin 地址發給我們。</p>
          <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
              Land 客服</a>。</p>
          <p>感謝支持創作。</p>
          <p>Liker Land</p>
          <br/>
          <br/>
          <p>Dear Liker,</p>
          <p>Thank you for purchasing the Writing NFT of "<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>". We need you to provide us with your
            LikeCoin wallet address so that we can send the Writing NFT to you.</p>
          <p><strong>Method 1: Log in to your Liker ID</strong></p>
          <p>You can always log in to your Liker ID through the Liker Land mobile app and check your LikeCoin wallet address.</p>
          <p><strong>Method 2: Install Keplr</strong></p>
          <p>If you want to receive the Writing NFT with a new LikeCoin address, you can refer to the following steps and install the Keplr wallet 
            on the Chrome browser.</p>
          <p><a href="https://docs.like.co/general-guides/wallet/keplr">How to install Keplr and use LikeCoin</a></p>
          <p>After completing the installation, you will be able to view your Writing NFT collection on the <a href="https://liker.land/">Liker Land website</a>.</p>
          <p>＋＋＋＋</p>
          <p>Please reply to this email with your LikeCoin wallet address.</p>
          <p>If you encounter any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
            Land customer service</a>.</p>
          <p>Thank you for supporting creativity.</p>
          <p>Liker Land</p>
          `,
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
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: '領取你的 NFT 書 | Claim your NFT Book',
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
          <p>親愛的 Liker：</p>
          <p>感謝購買 《<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>》的 NFT 書，我們需要你的 LikeCoin 錢包地址以把 NFT 書發送給你。</p>
          <p>1. 前往<a href="https://${NFT_BOOKSTORE_HOSTNAME}/claim-nft-book/${classId}/?payment_id=${paymentId}&token=${claimToken}">NFT 書錢包認證頁</a></p>
          <p>2. 輸入你的 LikeCoin 錢包地址</p>
          <p><strong>安裝 Keplr</strong></p>
          <p>若你想用新的 LikeCoin 地址接收 NFT 書，可參看以下步驟，在 Chrome 瀏覽器安裝 Keplr 錢包。</p>
          <p><a href="https://youtu.be/WQGW1P0KgOA">如何安裝 Keplr 及使用 LikeCoin （國語）</a></p>
          <p><a href="https://youtu.be/oOC7jjHI5_g">如何安裝 Keplr 及使用 LikeCoin （廣東話）</a></p>
          <p>完成安裝後，你可以回到步驟1的頁面，點選「connect」按鈕，即可獲取地址。</p>
          <p>3. 驗證完成後，請等待作者簽署給發送書籍
          <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
              Land 客服</a>。</p>
          <p>感謝支持創作。</p>
          <p>Liker Land</p>
          <br/>
          <br/>
          <p>Dear Liker,</p>
          <p>Thank you for purchasing the NFT Book of "<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>". We need you to provide us with your
            LikeCoin wallet address so that we can send the NFT Book to you.</p>
          <p>1. Go to <a href="https://${NFT_BOOKSTORE_HOSTNAME}/claim-nft-book/${classId}/?payment_id=${paymentId}&token=${claimToken}">NFT book wallet verification page</a></p>
          <p>2. Enter your LikeCoin wallet address</p>
          <p><strong>Install Keplr</strong></p>
          <p>If you want to receive the NFT Book with a new LikeCoin address, you can refer to the following steps and install the Keplr wallet 
            on the Chrome browser.</p>
          <p><a href="https://docs.like.co/general-guides/wallet/keplr">How to install Keplr and use LikeCoin</a></p>
          <p>After completing the installation, go back to the link in step 1 and click "connect" to retrieve your wallet address.</p>
          <p>3. Wait for the author to sign and deliver your NFT book.
          <p>If you encounter any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
            Land customer service</a>.</p>
          <p>Thank you for supporting creativity.</p>
          <p>Liker Land</p>
          `,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}
