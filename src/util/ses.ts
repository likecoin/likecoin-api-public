/* eslint-disable no-underscore-dangle */
import EmailTemplate from '@likecoin/likecoin-email-templates';
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
              href="${getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' })}">${className}</a>》的 Writing NFT。</p>
          <p>你的信箱先前已與地址為 ${wallet} 的錢包完成驗證，你所購買的 Writing NFT 已發送至該錢包。</p>
          <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker
              Land 客服</a>。</p>
          <p>感謝支持創作。</p>
          <p>Liker Land</p>
          <br/>
          <br/>
          <p>Dear Liker,</p>
          <p>Thank you for purchasing the Writing NFT of "<a
              href="${getLikerLandNFTClassPageURL({ classId, language: 'en' })}">${className}</a>".</p>
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
          <p>感謝購買 《<a href="${getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' })}">${className}</a>》。</p>
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
          <p>1. 點擊此<a href="${getLikerLandNFTClaimPageURL({
            classId,
            paymentId,
            token: claimToken,
            language: 'zh-Hant',
          })}">驗證電郵連結</a>，點選「連接錢包」按鈕，再點選彈出視窗的「Keplr」選項。</p>
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
          <p>Thank you for purchasing "<a href="${getLikerLandNFTClassPageURL({ classId, language: 'en' })}">${className}</a>".</p>
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
          <p>1. Click on this <a href="${getLikerLandNFTClaimPageURL({
            classId,
            paymentId,
            token: claimToken,
            language: 'en',
          })}">email verification link</a>, then click the "Connect Wallet" button and select "Keplr" from the pop-up window.</p>
          <p>2. Click the "Approve" button on the Keplr pop-up window to sign and complete the wallet connection.</p>
          <p>3. Your email address has been pre-set in the mailbox settings page. Click the "Confirm" button, and the system will send a verification email to your inbox.</p>
          <p>4. Click on the verification link in the email to complete the verification process.</p>
          <br/>
          <p>After completing the above two steps, the system will send the Writing NFT you purchased to you. You can check it in "My Dashboard" on Liker Land.</p>
          <br/>
          <p>If you have any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land Customer Service</a>.</p>
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
              href="${getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' })}">${className}</a>》的 NFT 書，我們需要你的 LikeCoin 錢包地址以把 NFT 書發送給你。</p>
          <p>1. 前往<a href="${getLikerLandNFTClaimPageURL({
            classId,
            paymentId,
            token: claimToken,
            type: 'nft_book',
            language: 'zh-Hant',
          })}">NFT 書錢包認證頁</a></p>
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
              href="${getLikerLandNFTClassPageURL({ classId, language: 'en' })}">${className}</a>". We need you to provide us with your
            LikeCoin wallet address so that we can send the NFT Book to you.</p>
          <p>1. Go to <a href="${getLikerLandNFTClaimPageURL({
            classId,
            paymentId,
            token: claimToken,
            type: 'nft_book',
            language: 'en',
          })}">NFT book wallet verification page</a></p>
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

export function sendNFTBookSalesEmail({
  emails,
  buyerEmail,
  classId,
  amount,
}) {
  if (TEST_MODE) return Promise.resolve();
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
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: `You have sold an NFT for $${amount}`,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
          <p>Dear Liker,</p>
          <p>${buyerEmail} bought your NFT book ${classId} for $${amount}</p>
          `,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export function sendNFTBookClaimedEmail({
  emails, classId, paymentId, wallet, message, buyerEmail,
}) {
  if (TEST_MODE) return Promise.resolve();
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
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: `A user ${buyerEmail} has claim their NFT book ${classId}`,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
          <p>Dear Liker,</p>
          <p>${buyerEmail}(${wallet}) claim their NFT book ${classId}${message ? ` with message: ${message}` : ''}
          <p>Please go to <a href="https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/send/${classId}/?payment_id=${paymentId}">NFT book management page</a> to deliver your book NFT.</p>
          `,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}
