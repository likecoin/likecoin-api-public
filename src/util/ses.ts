/* eslint-disable no-underscore-dangle */
import EmailTemplate from '@likecoin/likecoin-email-templates';
import aws from 'aws-sdk';
import { LIKER_LAND_HOSTNAME, NFT_BOOKSTORE_HOSTNAME, TEST_MODE } from '../constant';

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
          <p>親愛的讀者：</p>
          <p>感謝購買 《<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>》。</p>
          <p>請完成以下兩個簡單步驟，以領取作品的 Writing NFT：</p>
          <p>1）連接錢包</p>
          <p>2）驗證電郵地址</p>
          <br/>
          <b>步驟一：連接錢包</b>
          <p>先在 Chrome 瀏覽器安裝 Keplr 錢包，請參考以下教學影片：</p>
          <p><a href="https://youtu.be/WQGW1P0KgOA">如何安裝 Keplr 及使用 LikeCoin （國語）</a></p>
          <p><a href="https://youtu.be/oOC7jjHI5_g">如何安裝 Keplr 及使用 LikeCoin （廣東話）</a></p>
          <p>若你已安裝 Keplr 錢包，可跳過此步驟。</p>
          <br/>
          <b>步驟二：驗證電郵地址</b>
          <p>1. 點擊此<a href="https://${LIKER_LAND_HOSTNAME}/zh-Hant/settings/email?claim_pending_nft=true&email=${encodeURIComponent(email)}&class_id=${classId}&payment_id=${paymentId}&claiming_token=${claimToken}">Liker Land 驗證電郵連結</a>，點選「連接錢包」按鈕，再點選彈出視窗的「Keplr」選項。</p>
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
          <p>Dear Liker,</p>
          <p>Thank you for purchasing the Writing NFT of "<a
              href="https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}">${className}</a>".</p>
          <p>Please complete the following two steps so that we can deliver your Writing NFT to you.</p>
          <p>1. Connect your LikeCoin wallet</p>
          <p>2. Verify your email address</p>
          <br/>
          <p><b>Step 1. Connect your LikeCoin wallet</strong></b></p>
          <p>To obtain your new LikeCoin address, please refer to the following steps and install the Keplr wallet 
            on the Chrome browser.</p>
          <p><a href="https://docs.like.co/general-guides/wallet/keplr">How to install Keplr and use LikeCoin</a></p>
          <p>You can skip this step if you already have Keplr wallet installed</p>
          <br/>
          <p><b>Step 2. Verify your email adddress</b></p>
          <p>1. Open the <a href="https://${LIKER_LAND_HOSTNAME}/en/settings/email?claim_pending_nft=true&email=${encodeURIComponent(email)}&class_id=${classId}&payment_id=${paymentId}&claiming_token=${claimToken}">Liker Land email verification link</a>. Press "Connect Wallet" on the top right hand corner, then choose Keplr in the popup dialog.</p>
          <p>2. Click "Approve" in the Keplr popup dialog to sign and connect your LikeCoin wallet</p>
          <p>3. Your email address should already be prefilled. Press "Confirmed" and a verification email will be sent to you</p>
          <p>4. Click the link in the verification email to complete email verification.</p>
          <br/>
          <p>After completing the above steps. Your Writing NFT will be automatically sent to your provided LikeCoin address。You can see all your collected works in the "My Dashboard" on Liker Land</p>
          <br/>
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
