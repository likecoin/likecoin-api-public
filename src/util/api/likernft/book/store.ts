import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import { getNftBookInfo, NFT_BOOK_TEXT_DEFAULT_LOCALE } from '.';
import { W3C_EMAIL_REGEX, PUBSUB_TOPIC_MISC } from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { likeNFTBookCollection } from '../../../firebase';
import publisher from '../../../gcloudPub';
import { sendNFTBookSalesSlackNotification } from '../../../slack';
import {
  createNewNFTBookPayment,
  processNFTBookPurchase,
  sendNFTBookPurchaseEmail,
  claimNFTBook,
} from './purchase';

export async function handleGiftBook(
  classId: string,
  priceIndex: number,
  receivers: {
    email?: string;
    wallet?: string;
    fromName?: string;
    toName?: string;
    message?: string;
  }[],
  {
    defaultToName,
    defaultFromName,
    defaultMessage,
  }: {
    defaultToName?: string;
    defaultFromName?: string;
    defaultMessage?: string;
  },
  req,
) {
  const promises = [getNFTClassDataById(classId), getNftBookInfo(classId)];
  const [metadata, bookInfo] = (await Promise.all(promises)) as any;
  if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
  const {
    prices,
    notificationEmails,
    mustClaimToView = false,
  } = bookInfo;
  if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
  const {
    priceInDecimal,
    stock,
    name: priceNameObj,
    isPhysicalOnly = false,
  } = prices[priceIndex];
  const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
  if (stock <= 0 || stock < receivers.length) throw new ValidationError('OUT_OF_STOCK');

  const bookRef = likeNFTBookCollection.doc(classId);

  const result: any = [];
  for (let i = 0; i < receivers.length; i += 1) {
    const { email, wallet } = receivers[i];
    if (!email && !wallet) throw new ValidationError('REQUIRE_WALLET_OR_EMAIL');
    if (email) {
      const isEmailInvalid = !W3C_EMAIL_REGEX.test(email);
      if (isEmailInvalid) throw new ValidationError('INVALID_EMAIL');
    }

    if (email) {
      const query = await bookRef.collection('transactions')
        .where('email', '==', email)
        .where('type', '==', 'gift')
        .limit(1)
        .get();
      if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
    }
    if (wallet) {
      const query = await bookRef.collection('transactions')
        .where('wallet', '==', wallet)
        .where('type', '==', 'gift')
        .limit(1)
        .get();
      if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
    }
  }

  for (let i = 0; i < receivers.length; i += 1) {
    const {
      email,
      wallet,
      fromName: customFromName,
      toName: customToName,
      message: customMessage,
    } = receivers[i];
    const paymentId = uuidv4();
    const claimToken = crypto.randomBytes(32).toString('hex');

    const fromName = customFromName || defaultFromName || '';
    const toName = customToName || defaultToName || '';
    const message = customMessage || defaultMessage || '';

    await createNewNFTBookPayment(classId, paymentId, {
      type: 'gift',
      email,
      claimToken,
      priceInDecimal,
      priceName,
      priceIndex,
      giftInfo: {
        toName,
        toEmail: email || '',
        fromName,
        message,
      },
      isPhysicalOnly,
    });

    await processNFTBookPurchase({
      classId,
      email,
      paymentId,
      shippingDetails: null,
      shippingCost: null,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTGifted',
      paymentId,
      classId,
      email,
    });

    const className = metadata?.name || classId;
    await Promise.all([
      sendNFTBookPurchaseEmail({
        email,
        notificationEmails,
        classId,
        bookName: className,
        priceName,
        paymentId,
        claimToken,
        giftInfo: {
          toName,
          toEmail: email || '',
          fromName,
          message,
        },
        isGift: true,
        amountTotal: 0,
        mustClaimToView,
        isPhysicalOnly,
      }),
      sendNFTBookSalesSlackNotification({
        classId,
        bookName: className,
        paymentId,
        email: email || '',
        priceName,
        priceWithCurrency: 'FREE',
        method: 'gift',
      }),
    ]);

    if (wallet) {
      const { nftId } = await claimNFTBook(
        classId,
        paymentId,
        {
          message: '',
          wallet,
          token: claimToken as string,
        },
        req,
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimed',
        paymentId,
        classId,
        wallet,
        email,
        message: '',
      });
      if (nftId) result.push({ wallet, nftId });
    }
  }
  return result;
}

export default handleGiftBook;
