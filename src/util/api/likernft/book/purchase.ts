import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';

import { NFT_BOOK_TEXT_DEFAULT_LOCALE, createNewNFTBookPayment, getNftBookInfo } from '.';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { ValidationError } from '../../../ValidationError';
import { getLikerLandNFTClaimPageURL, getLikerLandNFTClassPageURL } from '../../../liker-land';
import {
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  NFT_BOOK_SALE_DESCRIPTION,
  USD_TO_HKD_RATIO,
  LIST_OF_BOOK_SHIPPING_COUNTRY,
} from '../../../../constant';
import { parseImageURLFromMetadata, encodedURL } from '../metadata';
import { calculateStripeFee, checkIsFromLikerLand } from '../purchase';
import { getStripeConnectAccountId } from './user';
import stripe from '../../../stripe';
import {
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
} from '../../../../../config/config';


export async function handleNewStripeCheckout(classId: string, priceIndex: number, {
  gaClientId,
  from: inputFrom,
}: {
  gaClientId?: string,
  from?: string,
} = {}) {
  const promises = [getNFTClassDataById(classId), getNftBookInfo(classId)];
  const [metadata, bookInfo] = (await Promise.all(promises)) as any;
  if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');

  const paymentId = uuidv4();
  const claimToken = crypto.randomBytes(32).toString('hex');
  const {
    prices,
    successUrl = getLikerLandNFTClaimPageURL({
      classId,
      paymentId,
      token: claimToken,
      type: 'nft_book',
      redirect: true,
    }),
    cancelUrl = getLikerLandNFTClassPageURL({ classId }),
    ownerWallet,
    connectedWallets,
    shippingRates,
    defaultPaymentCurrency = 'USD',
    defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
  } = bookInfo;
  if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }
  const {
    priceInDecimal,
    stock,
    hasShipping,
    name: priceNameObj,
    description: pricDescriptionObj,
  } = prices[priceIndex];
  if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
  if (priceInDecimal === 0) {
    const freePurchaseUrl = getLikerLandNFTClaimPageURL({
      classId,
      paymentId: '',
      token: '',
      type: 'nft_book',
      free: true,
      redirect: false,
      priceIndex,
      from: from as string,
    });
    return { url: freePurchaseUrl };
  }
  let { name = '', description = '' } = metadata;
  const classMetadata = metadata.data.metadata;
  const iscnPrefix = metadata.data.parent.iscnIdPrefix || undefined;
  let { image } = classMetadata;
  image = parseImageURLFromMetadata(image);
  name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
  const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
  const priceDescription = typeof pricDescriptionObj === 'object' ? pricDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : pricDescriptionObj || '';
  if (priceName) {
    name = `${name} - ${priceName}`;
  }
  if (NFT_BOOK_SALE_DESCRIPTION[classId]) {
    description = NFT_BOOK_SALE_DESCRIPTION[classId];
  } else if (priceDescription) {
    description = `${description} - ${priceDescription}`;
  }

  if (from) description = `[${from}] ${description}`;
  description = description.length > 300
    ? `${description.substring(0, 299)}…`
    : description;
  if (!description) {
    description = undefined;
  } // stripe does not like empty string
  const sessionMetadata: Stripe.MetadataParam = {
    store: 'book',
    classId,
    iscnPrefix,
    paymentId,
    priceIndex,
    ownerWallet,
  };
  if (gaClientId) sessionMetadata.gaClientId = gaClientId as string;
  if (from) sessionMetadata.from = from as string;
  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    capture_method: 'manual',
    metadata: sessionMetadata,
  };

  const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
  const shouldConvertUSDtoHKD = convertedCurrency === 'HKD';
  let convertedPriceInDecimal = priceInDecimal;
  if (shouldConvertUSDtoHKD) {
    convertedPriceInDecimal = Math.round((convertedPriceInDecimal * USD_TO_HKD_RATIO) / 10) * 10;
  }

  if (connectedWallets && Object.keys(connectedWallets).length) {
    const isFromLikerLand = checkIsFromLikerLand(from);
    const wallet = Object.keys(connectedWallets)[0];
    const stripeConnectAccountId = await getStripeConnectAccountId(wallet);
    if (stripeConnectAccountId) {
      const stripeFeeAmount = calculateStripeFee(convertedPriceInDecimal, convertedCurrency);
      const likerLandFeeAmount = Math.ceil(
        convertedPriceInDecimal * NFT_BOOK_LIKER_LAND_FEE_RATIO,
      );
      const likerLandCommission = isFromLikerLand
        ? Math.ceil(convertedPriceInDecimal * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO)
        : 0;

      // TODO: support connectedWallets +1
      paymentIntentData.application_fee_amount = (
        stripeFeeAmount + likerLandFeeAmount + likerLandCommission
      );
      paymentIntentData.transfer_data = {
        destination: stripeConnectAccountId,
      };
    }
  }

  const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    success_url: `${successUrl}`,
    cancel_url: `${cancelUrl}`,
    line_items: [
      {
        price_data: {
          currency: convertedCurrency,
          product_data: {
            name,
            description,
            images: [encodedURL(image)],
            metadata: {
              iscnPrefix,
              classId: classId as string,
            },
          },
          unit_amount: convertedPriceInDecimal,
        },
        adjustable_quantity: {
          enabled: false,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: paymentIntentData,
    metadata: sessionMetadata,
  };
  if (hasShipping) {
    checkoutPayload.shipping_address_collection = {
    // eslint-disable-next-line max-len
      allowed_countries: LIST_OF_BOOK_SHIPPING_COUNTRY as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    };
    if (shippingRates) {
      checkoutPayload.shipping_options = shippingRates.map((s) => {
        const { name: shippingName, priceInDecimal: shippingPriceInDecimal } = s;
        let convertedShippingPriceInDecimal = shippingPriceInDecimal;
        if (shouldConvertUSDtoHKD) {
          convertedShippingPriceInDecimal = Math.round(
            (shippingPriceInDecimal * USD_TO_HKD_RATIO) / 10,
          ) * 10;
        }
        return {
          shipping_rate_data: {
            display_name: shippingName[NFT_BOOK_TEXT_DEFAULT_LOCALE],
            type: 'fixed_amount',
            fixed_amount: {
              amount: convertedShippingPriceInDecimal,
              currency: convertedCurrency,
            },
          },
        };
      });
    }
  }
  const session = await stripe.checkout.sessions.create(checkoutPayload);
  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookPayment(classId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    priceInDecimal,
    priceName,
    priceIndex,
    from: from as string,
  });

  return {
    url,
    paymentId,
    priceName,
    priceInDecimal,
    sessionId,
  };
}

export default handleNewStripeCheckout;
