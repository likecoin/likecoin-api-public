/* eslint-disable no-underscore-dangle */
import { getBasicTemplate, getBasicV2Template } from '@likecoin/edm';
import aws from 'aws-sdk';
import { TEST_MODE } from '../constant';
import { getLikerLandNFTClaimPageURL, getLikerLandNFTClassPageURL, getLikerLandNFTCollectionPageURL } from './liker-land';
import { getNFTBookStoreCollectionSendPageURL, getNFTBookStoreSendPageURL } from './api/likernft/book';

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
  classIds,
  firstClassName,
  wallet,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '你的 Writing NFT 已送達 | Your Writing NFT has arrived';
  const firstClassId = classIds[0];
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'zh-Hant' });
  const pluralDescriptionZh = classIds.length > 1 ? `等 ${classIds.length} 個作品` : '';
  const pluralDescriptionEn = classIds.length > 1 ? ` and ${classIds.length - 1} other work${classIds.length > 2 ? 's' : ''}` : '';
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendAutoClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            <p>感謝購買 《<a href="${nftClassURLZh}">${firstClassName}</a>》${pluralDescriptionZh}的 Writing NFT。</p>
            <p>你的信箱先前已與地址為 ${wallet} 的錢包完成驗證，你所購買的 Writing NFT 已發送至該錢包。</p>
            <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land 客服</a>。</p>
            <p>感謝支持創作。</p>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear Liker,</p>
            <p>Thank you for purchasing the Writing NFT of "<a href="${nftClassURLEn}">${firstClassName}</a>"${pluralDescriptionEn}.</p>
            <p>Your email is previously linked with the wallet address ${wallet}, the Writing NFT you purchased has been sent to the wallet.</p>
            <p>If you encounter any problems, please contact <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land customer service</a>.</p>
            <p>Thank you for supporting creativity.</p>
            <p>Liker Land</p>`,
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
  const title = '領取你的 Writing NFT | Claim your Writing NFT';
  const firstClassId = classIds[0];
  const nftClassURLEn = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'en' });
  const nftClassURLZh = getLikerLandNFTClassPageURL({ classId: firstClassId, language: 'zh-Hant' });
  const claimURLEn = getLikerLandNFTClaimPageURL({
    classId: firstClassId,
    paymentId,
    token: claimToken,
    language: 'en',
  });
  const claimURLZh = getLikerLandNFTClaimPageURL({
    classId: firstClassId,
    paymentId,
    token: claimToken,
    language: 'zh-Hant',
  });
  const pluralDescriptionZh = classIds.length > 1 ? `等 ${classIds.length} 個作品` : '';
  const pluralDescriptionEn = classIds.length > 1 ? ` and ${classIds.length - 1} other work${classIds.length > 2 ? 's' : ''}` : '';
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            <p>感謝購買 《<a href="${nftClassURLZh}">${firstClassName}</a>》${pluralDescriptionZh}。</p>
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
            <p>完成以上兩步驟後，系統將把你購買的 Writing NFT 發送給你。你可以到 Liker Land 的「個人主頁」查看。</p>
            <br/>
            <p>若遇到任何問題，請聯絡 <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">Liker Land 客服</a>。</p>
            <p>感謝支持創作。</p>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear reader,</p>
            <p>Thank you for purchasing "<a href="${nftClassURLEn}">${firstClassName}</a>"${pluralDescriptionEn}.</p>
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

export function sendNFTBookListingEmail({
  classId = '',
  collectionId = '',
  bookName,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `New NFT Book listing: ${bookName}`;
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId })
    : getLikerLandNFTClassPageURL({ classId });
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookListingEmail',
      },
    ],
    Destination: {
      ToAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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

export function sendNFTBookPendingClaimEmail({
  email,
  classId = '',
  collectionId = '',
  bookName,
  paymentId,
  claimToken,
  mustClaimToView = false,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '領取你的電子書 | Claim your eBook';
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
  });
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            content: `<p>親愛的讀者：</p>
            <p>感謝支持並購買<a href="${nftPageURLZh}">《${bookName}》</a>。請根據以下步驟領取你的電子書：</p>
            <ol>
              <li>
                <p>選以下任一方法<a href="https://liker.land/zh-Hant">登入/註冊 Liker Land 帳號</a></p>
                <p>
                a. 電郵地址/密碼<br>
                b. Google 帳號登入<br>
                c. Apple ID 登入
                </p>
                <p>或；</p>
                d. 以 Keplr 錢包登入（安裝方法請參考此<a href="https://youtu.be/zUIvj18hEXY">國語教學影片</a>或<a href="https://youtu.be/8sdDNkwzknE">廣東話版教學影片</a>，或參考<a href="https://docs.like.co/v/zh/general-guides/wallet/keplr/how-to-install-keplr-extension">圖文教學</a>）
              </li>
              <li>
                <p>在<a href="${claimPageURLZh}">下載頁面</a>領取電子書。</p>
              </li>
              <li>
                <p>若你購買的電子書需要作者親自簽發，請在完成以上兩個步驟後，耐心等待作者發貨，一般 3 天內會發出。你可前往 <a href="https://liker.land/zh-Hant/feed?view=collectibles&tab=collected">Liker Land 個人主頁</a>查看電子書的狀態。</p>
              </li>
            </ol>
            <p>如有任何疑問，歡迎<a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">聯絡客服</a>查詢。</p>
            <p>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>Liker Land</p>
            <br>
            <hr />
            <br>
            <p>Dear reader,</p>
            <p>Thanks for purchasing <a href="${nftPageURLEn}">“${bookName}”</a>. Please follow the steps below to claim your ebook:</p>
            <ol>
              <li>
                <p>Choose any of the following methods to <a href="https://liker.land/en">log in/register a Liker Land account</a>:</p>
                <p>
                a. Email address/password<br>
                b. Google account login<br>
                c. Apple ID login<br>
                </p>
                <p>Or;</p>
                <p>d. Log in with a Keplr wallet (For installation methods, please refer to this <a href="https://youtu.be/T2Ik9HJJSM8">tutorial video</a>, or refer to the <a href="https://docs.like.co/v/zh/general-guides/wallet/keplr/how-to-install-keplr-extension">illustrated guide</a>)</p>
              </li>
              <li>
                <p>Claim the e-book on the <a href="${claimPageURLEn}">download page</a>.</p>
              </li>
              <li>
                <p>If the e-book you purchased requires a personal signature from the author, please wait patiently for the author to dispatch it after completing the above two steps, typically within 3 days. You can check the status of the e-book on your <a href="https://liker.land/en/feed?view=collectibles&tab=collected">Liker Land dashboard</a>.</p>
              </li>
            </ol>
            <p>If you have any questions, please feel free to contact our <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">customer service</a> for assistance.</p>
            <p>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>Liker Land</p>`,
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
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '購買成功｜Thank you for your purchase!';
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            content: `<p>親愛的讀者：</p>
            <p>感謝支持並購買 <a href="${nftPageURLZh}">《${bookName}》- ${priceName}</a>。</p>
            <p>我們會安排寄送，所需大約 3-5 天時間。感謝支持！</p>
            <br />
            <p>如有任何疑問，歡迎<a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">聯絡客服</a>查詢。</p>
            <p>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>Liker Land</p>
            <hr />
            <p>Dear reader,</p>
            <p>Thank you for your support and purchasing "<a href="${nftPageURLEn}">${bookName} - ${priceName}</a></p>
            <p>We will arrange delivery, which will take about 3-5 days. Thank you for your support!</p>
            <p>If you have any questions, please feel free to contact our <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">customer service</a> for assistance.</p>
            <p>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>Liker Land</p>`,
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
  mustClaimToView,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `${fromName} 送了一本電子書禮物給你 | ${fromName} has sent you a eBook gift from Liker Land`;
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const claimPageURLEn = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'en',
  });
  const claimPageURLZh = getLikerLandNFTClaimPageURL({
    classId,
    collectionId,
    paymentId,
    token: claimToken,
    type: 'nft_book',
    language: 'zh-Hant',
  });
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftPendingClaimEmail',
      },
    ],
    Destination: {
      ToAddresses: [toEmail],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            content: `<p>親愛的${toName}：</p>
            <p>${fromName} 贈送了一本 <a href="${nftPageURLZh}">《${bookName}》</a> 電子書給你作為禮物。</p>
            <p>以下是 ${fromName} 的留言：</p>
            <p>${message}</p>
            <br/>
            <p>感謝支持並購買<a href="${nftPageURLZh}">《${bookName}》</a>。請根據以下步驟領取你的電子書：</p>
            <ol>
              <li>
                <p>選以下任一方法<a href="https://liker.land/zh-Hant">登入/註冊 Liker Land 帳號</a></p>
                <p>
                a. 電郵地址/密碼<br>
                b. Google 帳號登入<br>
                c. Apple ID 登入
                </p>
                <p>或；</p>
                d. 以 Keplr 錢包登入（安裝方法請參考此<a href="https://youtu.be/zUIvj18hEXY">國語教學影片</a>或<a href="https://youtu.be/8sdDNkwzknE">廣東話版教學影片</a>，或參考<a href="https://docs.like.co/v/zh/general-guides/wallet/keplr/how-to-install-keplr-extension">圖文教學</a>）
              </li>
              <li>
                <p>在<a href="${claimPageURLZh}">下載頁面</a>領取電子書。</p>
              </li>
              <li>
                <p>若你購買的電子書需要作者親自簽發，請在完成以上兩個步驟後，耐心等待作者發貨，一般 3 天內會發出。你可前往 <a href="https://liker.land/zh-Hant/feed?view=collectibles&tab=collected">Liker Land 個人主頁</a>查看電子書的狀態。</p>
              </li>
            </ol>
            <p>如有任何疑問，歡迎<a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">聯絡客服</a>查詢。</p>
            <p>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <p>Liker Land</p>
            <br>
            <hr />
            <br>
            <p>Dear ${toName},</p>
            <p>${fromName} has send an eBook <a href="${nftPageURLEn}">“${bookName}“</a>” to you as a gift</p>
            <p>Here is ${fromName}'s message</p>
            <p>${message}</p>
            <br/>
            <p>Thanks for purchasing <a href="${nftPageURLEn}">“${bookName}”</a>. Please follow the steps below to claim your ebook:</p>
            <ol>
              <li>
                <p>Choose any of the following methods to <a href="https://liker.land/en">log in/register a Liker Land account</a>:</p>
                <p>
                a. Email address/password<br>
                b. Google account login<br>
                c. Apple ID login<br>
                </p>
                <p>Or;</p>
                <p>d. Log in with a Keplr wallet (For installation methods, please refer to this <a href="https://youtu.be/T2Ik9HJJSM8">tutorial video</a>, or refer to the <a href="https://docs.like.co/v/zh/general-guides/wallet/keplr/how-to-install-keplr-extension">illustrated guide</a>)</p>
              </li>
              <li>
                <p>Claim the e-book on the <a href="${claimPageURLEn}">download page</a>.</p>
              </li>
              <li>
                <p>If the e-book you purchased requires a personal signature from the author, please wait patiently for the author to dispatch it after completing the above two steps, typically within 3 days. You can check the status of the e-book on your <a href="https://liker.land/en/feed?view=collectibles&tab=collected">Liker Land dashboard</a>.</p>
              </li>
            </ol>
            <p>If you have any questions, please feel free to contact our <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">customer service</a> for assistance.</p>
            <p>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <p>Liker Land</p>`,
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
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = '你的 NFT 書實體商品已發送 | Your NFT Book physical merch has been shipped';
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'en' })
    : getLikerLandNFTClassPageURL({ classId, language: 'en' });
  const nftPageURLZh = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId, language: 'zh-Hant' })
    : getLikerLandNFTClassPageURL({ classId, language: 'zh-Hant' });
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookShippedEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            <p>感謝支持並購買 <a href="${nftPageURLZh}">《${bookName}》</a>。</p>
            <p>你的實體商品已發送，以下是作者提供的資訊：</p>
            <p>${message}</p>
            <p>如有任何疑問，歡迎<a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">聯絡客服</a>查詢。</p>
            <p>感謝珍藏此書，願你享受閱讀的樂趣。</p>
            <br/>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear reader,</p>
            <br/>
            <p>Thank you for your support and purchasing "<a href="${nftPageURLEn}">${bookName}</a>".</p>
            <p>The physical merchanise that come with your book has been shipped, following is the message provided by author</p>
            <p>${message}</p>
            <p>If you have any questions, please feel free to contact our <a href="https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7">customer service</a> for assistance.</p>
            <p>Thank you for cherishing this book, and may you enjoy the pleasure of reading.</p>
            <br/>
            <p>Liker Land</p>`,
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
  const title = `${toName} 已接受你的禮物電子書 ${bookName} | ${toName} has accepted your eBook gift ${bookName}`;
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftClaimedEmail',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            content: `<p>親愛的${fromName}：</p>
            <br/>
            <p>你送給 ${toName} 的 ${bookName} 已被接受</p>
            <p>作者將會在稍後簽署給發送電子書給 ${toName} </p>
            <p>感謝你分享閱讀的樂趣</p>
            <br/>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear ${fromName},</p>
            <br/>
            <p>Your eBook gift of ${bookName} has been accepted by ${toName}</p>
            <p>Author will soon sign and send the eBook copy to ${toName}</p>
            <p>Thank you for sharing the joy of reading.</p>
            <br>
            <p>Liker Land</p>`,
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
  const title = `你給 ${toName} 的禮物電子書 ${bookName} 已經發送 | Your eBook gift to ${toName} has been delivered`;
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookGiftSentEmail',
      },
    ],
    Destination: {
      ToAddresses: [fromEmail],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            content: `<p>親愛的${fromName}：</p>
            <br/>
            <p>你購買的 ${bookName} 已成功發送給 ${toName}</p>
            <p>如需瀏覽技術細節，請按<a href="https://mintscan.com/likecoin/txs/${txHash}">此連結</a></p>
            <p>感謝你分享閱讀的樂趣</p>
            <br/>
            <p>Liker Land</p>
            <br/>
            <br/>
            <p>Dear ${fromName},</p>
            <br/>
            <p>Your gift ${bookName} has been delivered to ${toName}</p>
            <p>For technical details, visit <a href="https://mintscan.com/likecoin/txs/${txHash}">transaction detail page</a></p>
            <p>Thank you for sharing the joy of reading</p>
            <br>
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
  if (TEST_MODE) return Promise.resolve();
  const title = `You have sold an Book for $${amount}`;
  let content = `<p>Dear Creator,</p>
  <br/>
  <p>Congratulation!</p>
  <p>${buyerEmail} has bought your book ${bookName} for $${amount}${isGift ? ` as a gift to ${giftToName}<${giftToEmail}>` : ''}.</p>`;
  if (amount > originalPrice || shippingCost) {
    content += `<p>Price: $${originalPrice}</p>`;
    if (amount > originalPrice) {
      content += `<p>Tip: $${amount - originalPrice}</p>`;
    }
    if (shippingCost) {
      content += `<p>Shipping paid: $${shippingCost}</p>`;
    }
  }
  if (shippingDetails) {
    content += `<p>Shipping details: <pre>${JSON.stringify(shippingDetails, null, 2)}</pre></p>`;
    content += `<p>Phone: ${phone}</p>`;
  }
  content += `<p>Please deliver the book after the user has verified their wallet address. You will get another notification when they have done so.</p>
  <br/>
  <p>Liker Land</p>`;
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookSalesEmail',
      },
    ],
    Destination: {
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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

export function sendNFTBookSaleCommissionEmail({
  classId = '',
  collectionId = '',
  email,
  bookName,
  amount,
  type,
}) {
  if (TEST_MODE) return Promise.resolve();
  const nftPageURLEn = collectionId
    ? getLikerLandNFTCollectionPageURL({ collectionId })
    : getLikerLandNFTClassPageURL({ classId });
  const title = `You have earn $${amount} for helping selling ${bookName}`;
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookSaleCommissionEmail',
      },
    ],
    Destination: {
      ToAddresses: [email],
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            content: `<p>Dear Book lover,</p>
            <br/>
            <p>Congratulation!</p>
            <p>Someone has bought the NFT book <a href="${nftPageURLEn}">${bookName}</a></p>
            <p>As a result you have earn $${amount} due to commission type "${type}"</p>
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
  emails, classId = '', collectionId = '', bookName, paymentId, wallet, message, claimerEmail,
}) {
  if (TEST_MODE) return Promise.resolve();
  const title = `A user has claimed an ebook ${bookName}`;
  const url = collectionId
    ? getNFTBookStoreCollectionSendPageURL(collectionId, paymentId)
    : getNFTBookStoreSendPageURL(classId, paymentId);
  const params = {
    Source: '"Liker Land Sales" <sales@liker.land>',
    ConfigurationSetName: 'likeco_ses',
    Tags: [
      {
        Name: 'Function',
        Value: 'sendNFTBookClaimedEmail',
      },
    ],
    Destination: {
      ToAddresses: emails,
      BccAddresses: ['"Liker Land Sales" <sales@liker.land>'],
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
            <p>Congratulation. A reader has claimed your ebook${message ? ` with message: "${message}"` : ''}.</p>
            <p>Reader email: ${claimerEmail}</p>
            <p>Reader wallet address: ${wallet}</p>
            <p>Please visit the <a href="${url}">NFT book management page</a> to deliver your book.</p>
            <br>
            <p>Liker Land</p>`,
          }).body,
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}
