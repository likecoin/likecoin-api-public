/* eslint-disable no-underscore-dangle */
import EmailTemplate from '@likecoin/likecoin-email-templates';
import aws from 'aws-sdk';
import { LIKER_LAND_HOSTNAME, TEST_MODE } from '../constant';

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
  if (TEST_MODE) return Promise.resolve();
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

export function sendPendingClaimEmail({
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
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>》的 Writing NFT，我們需要你將 LikeCoin 錢包與你的信箱地址進行驗證，以把 Writing NFT 發送給你。</p>
          <p>1. 前往<a href="https://${LIKER_LAND_HOSTNAME}/zh-Hant/settings/email?claim_pending_nft=true&email=${encodeURIComponent(email)}&claiming_class_name=${encodeURIComponent(className)}&payment_id=${paymentId}&claiming_token=${claimToken}">Liker Land 網站信箱設定頁面</a>。</p>
          <p>2. 連接你的 LikeCoin 錢包：</p>
          <p><strong>方法一：使用你的 Liker ID登入</strong></p>
          <p>點選「驗證」按鈕，再點選浮動視窗下方的「其他連接方法」，接著點選「Liker ID」選項，產生登入用的二維碼。你可以使用 Liker Land 手機應用程式，以社交帳號方式登入後，掃描二維碼登入。</p>
          <p><strong>方法二：安裝 Keplr</strong></p>
          <p>若你想用新的 LikeCoin 地址接收 Writing NFT，可參看以下步驟，在 Chrome 瀏覽器安裝 Keplr 錢包。</p>
          <p><a href="https://youtu.be/WQGW1P0KgOA">如何安裝 Keplr 及使用 LikeCoin （國語）</a></p>
          <p><a href="https://youtu.be/oOC7jjHI5_g">如何安裝 Keplr 及使用 LikeCoin （廣東話）</a></p>
          <p>完成安裝後，你可以回到步驟1的頁面，點選「驗證」按鈕，再點選浮動視窗的「Keplr」選項，接著點選 Keplr 彈出視窗的「Approve」按鈕健行簽名，即可完成登入。</p>
          <p>3. 信箱設定頁面將自動代入你的信箱地址，請點選「確認」按鈕，系統將寄出驗證信到你的信箱，點選驗證信的連結完成驗證。</p>
          <p>4. 驗證完成後，會自動跳轉至<a href="https://${LIKER_LAND_HOSTNAME}/zh-Hant/nft/claim?claiming_class_name=${encodeURIComponent(className)}&payment_id=${paymentId}&claiming_token=${claimToken}">Writing NFT 領取頁面</a>，你可以將 Writing NFT 領取到你的錢包。</p>
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
