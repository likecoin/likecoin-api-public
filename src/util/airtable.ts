import Airtable, { FieldSet } from 'airtable';
import Stripe from 'stripe';

import {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
} from '../../config/config';

import { getUserWithCivicLikerPropertiesByWallet } from './api/users';
import { parseImageURLFromMetadata } from './api/likernft/metadata';

const BOOK_SALES_TABLE_NAME = 'Sales (Book)';
const PUBLICATIONS_TABLE_NAME = 'Publications';

let airtable: Airtable;
let base: Airtable.Base;

if (!process.env.CI) {
  airtable = new Airtable({ apiKey: AIRTABLE_API_KEY });
  base = airtable.base(AIRTABLE_BASE_ID);
}

export async function createAirtablePublicationRecord({
  timestamp,
  id,
  name,
  description,
  iscnIdPrefix,
  ownerWallet,
  type,
  minPrice,
  maxPrice,
  imageURL,
  author,
  language,
  keywords = [],
  usageInfo,
  isbn,
  iscnObject,
  iscnContentMetadata,
  metadata,
  isDRMFree = false,
}: {
  timestamp: Date;
  name: string;
  description: string;
  id: string;
  ownerWallet: string;
  type: string;
  minPrice: number;
  maxPrice: number;
  imageURL: string;
  author?: string;
  language?: string;
  keywords?: string[];
  usageInfo?: string;
  isbn?: string;
  iscnIdPrefix?: string;
  iscnObject?: any;
  iscnContentMetadata?: any;
  metadata?: any;
  isDRMFree?: boolean;
}): Promise<void> {
  if (!base) return;

  const normalizedImageURL = parseImageURLFromMetadata(imageURL);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields: any = {
      Timestamp: timestamp.toISOString(),
      'Owner Wallet': ownerWallet,
      Type: type,
      ID: id,
      Name: name,
      Description: description,
      Image: [{ url: normalizedImageURL }],
      'Image URL': normalizedImageURL,
      'Min Price': minPrice,
      'Max Price': maxPrice,
      'DRM-free': isDRMFree,
    };

    if (author) fields.Author = author;
    if (language) fields.Language = language;
    if (keywords?.length) fields.Keywords = keywords;
    if (usageInfo) fields['Usage Info'] = usageInfo;
    if (isbn) fields.ISBN = isbn;

    if (iscnIdPrefix) {
      fields['ISCN Id Prefix'] = iscnIdPrefix;
    }

    if (iscnObject) {
      try {
        fields['ISCN Object'] = JSON.stringify(iscnObject);
      } catch {
        // No-op
      }
    }

    if (iscnContentMetadata) {
      try {
        fields['ISCN Content Metadata'] = JSON.stringify(iscnContentMetadata);
      } catch {
        // No-op
      }
    }

    if (metadata) {
      try {
        fields.Metadata = JSON.stringify(metadata);
      } catch {
        // No-op
      }
    }

    const ownerData = await getUserWithCivicLikerPropertiesByWallet(ownerWallet);
    if (ownerData) {
      fields['Owner Liker Id'] = ownerData.user;
      fields['Owner Name'] = ownerData.displayName;
    }

    await base(PUBLICATIONS_TABLE_NAME).create([{ fields }], { typecast: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function queryAirtableForPublication({ query }) {
  try {
    const formattedQueryString = query.replaceAll('"', '');
    const formulas = [
      'Name',
      'Description',
    ].map((field) => `FIND("${formattedQueryString}", ${field})`);
    const formula = `OR(${formulas.join(',')})`; // more than 2 field in OR() it would error
    const res = await base(PUBLICATIONS_TABLE_NAME).select({
      fields: [
        'ID',
        'Description',
        'Image URL',
        'ISCN Id Prefix',
        'Max Price',
        'Min Price',
        'Name',
        'Owner Liker Id',
        'Owner Name',
        'Owner Wallet',
        'Timestamp',
        'Type',
        'Liker Land URL',
      ],
      filterByFormula: formula,
      view: 'All',
    }).firstPage();
    const result = res
      .map((r) => r.fields)
      .map(({
        Timestamp: timestamp,
        'Owner Wallet': ownerWallet,
        'Owner Liker Id': ownerLikerId,
        'Owner Name': ownerName,
        Type: type,
        ID: id,
        Name: name,
        'Image URL': imageUrl,
        'Min Price': minPrice,
        'Max Price': maxPrice,
        Description: description,
        'ISCN Id Prefix': iscnId,
        'Liker Land URL': url,
      }) => ({
        timestamp,
        ownerWallet,
        ownerLikerId,
        ownerName,
        type,
        id,
        name,
        url,
        imageUrl,
        minPrice,
        maxPrice,
        description,
        iscnId,
      }));
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  return null;
}

async function queryAirtablePublicationRecordById(id: string) {
  const [record] = await base(PUBLICATIONS_TABLE_NAME).select({
    maxRecords: 1,
    pageSize: 1,
    view: 'All',
    fields: ['ID'],
    filterByFormula: `{ID} = "${id}"`,
  }).firstPage();
  if (!record) {
    // eslint-disable-next-line no-console
    console.error(`Record with ID ${id} not found in ${PUBLICATIONS_TABLE_NAME} table.`);
  }
  return record;
}

function normalizeStripePaymentIntentForAirtableBookSalesRecord(
  {
    classId,
    collectionId,
    priceIndex,
    feeInfo,
    pi,
    transfers,
    from: channel,
    stripeFeeAmount,
    stripeFeeCurrency,
  }: {
    classId?: string,
    collectionId?: string,
    priceIndex?: number,
    feeInfo: any,
    pi: Stripe.PaymentIntent,
    transfers: Stripe.Transfer[],
    from?: string,
    stripeFeeAmount: number,
    stripeFeeCurrency: string,
  },
) {
  const {
    utmSource,
    referrer,
    gaClientId,
    gaSessionId,
  } = pi.metadata;
  const {
    likerLandArtFee: likerLandArtFeeRaw = 0,
    likerLandFeeAmount: calculatedLikerLandFeeRaw = 0,
    stripeFeeAmount: calculatedStripeFeeRaw = 0,
    likerLandTipFeeAmount: likerLandTipFeeRaw = 0,
    customPriceDiff: customPriceDiffRaw = 0,
    channelCommission: channelCommissionRaw = 0,
    likerLandCommission: likerLandCommissionRaw = 0,
  } = feeInfo;

  const date = new Date(pi.created * 1000);

  let customerEmail = '';
  let paymentMethod = 'unknown';
  let balanceTxAmount = 0;
  let balanceTxCurrency: string | undefined;
  let balanceTxExchangeRate: number | undefined;
  let balanceTxNetAmount = 0;
  let stripeFee = 0;
  let applicationFeeAmount = 0;
  let feeTotal = 0;

  function convertCurrency(amount: number) {
    return balanceTxExchangeRate ? amount * balanceTxExchangeRate : amount;
  }

  if (!pi.latest_charge || typeof pi.latest_charge === 'string') {
    // eslint-disable-next-line no-console
    console.error('Latest charge not found in the payment indent:', pi.id);
  } else {
    customerEmail = pi.latest_charge.billing_details?.email || '';

    const paymentMethodDetails = pi.latest_charge?.payment_method_details;
    if (paymentMethodDetails) {
      paymentMethod = paymentMethodDetails.type;
      if (paymentMethod === 'card' && paymentMethodDetails.card?.brand) {
        paymentMethod = paymentMethodDetails.card.brand;
      }
    }

    const balanceTx = pi.latest_charge.balance_transaction;
    if (!balanceTx || typeof balanceTx === 'string') {
      // eslint-disable-next-line no-console
      console.error('Balance transaction not found in the payment indent:', pi.id);
    } else {
      balanceTxCurrency = balanceTx.currency;
      if (balanceTx.exchange_rate) {
        balanceTxExchangeRate = balanceTx.exchange_rate;
      }

      stripeFee = (
        stripeFeeCurrency !== balanceTxCurrency
          ? convertCurrency(stripeFeeAmount)
          : stripeFeeAmount
      ) / 100;

      balanceTxAmount = (feeInfo.priceInDecimal || balanceTx.amount) / 100;
      balanceTxNetAmount = balanceTxAmount - stripeFee;

      feeTotal = balanceTx.fee / 100;

      if (pi.application_fee_amount) {
        const applicationFee = pi.latest_charge.application_fee;
        if (!applicationFee || typeof applicationFee === 'string') {
          // eslint-disable-next-line no-console
          console.error('Application fee not found in the payment indent:', pi.id);
        } else {
          // NOTE:
          // Liker Land commission is included in the application fee after the commission fix date
          applicationFeeAmount = (
            applicationFee.currency !== balanceTxCurrency
              ? convertCurrency(applicationFee.amount)
              : applicationFee.amount
          ) / 100;
        }
      }
    }
  }

  const editionIndex = priceIndex || 0;

  const hasApplicationFee = !!pi.transfer_data;
  const hasTransferGroup = !!pi.transfer_group;

  const transferredAmount = transfers.length
    ? transfers.reduce((acc, transfer) => {
      let amount = transfer.amount / 100;
      if (balanceTxCurrency !== transfer.currency) {
        amount = convertCurrency(amount);
      }
      return acc + amount;
    }, 0) : 0;

  // Note: Channel commission must be provided in metadata at checkout
  const channelCommission = convertCurrency(Number(channelCommissionRaw)) / 100 || 0;

  const likerLandCommission = convertCurrency(Number(likerLandCommissionRaw)) / 100 || 0;

  const likerLandArtFee = convertCurrency(Number(likerLandArtFeeRaw)) / 100 || 0;
  const likerLandTipFee = convertCurrency(Number(likerLandTipFeeRaw)) / 100 || 0;

  const customPriceDiff = convertCurrency(Number(customPriceDiffRaw)) / 100 || 0;

  const estimatedStripeFeeAmount = (convertCurrency(Number(calculatedStripeFeeRaw)) / 100)
    || stripeFee;
  const estimatedLikerLandFeeAmount = (convertCurrency(Number(calculatedLikerLandFeeRaw)) / 100)
    || balanceTxAmount * NFT_BOOK_LIKER_LAND_FEE_RATIO;

  let likerLandFee = 0;
  if (hasTransferGroup) {
    // simplified calculation using commission transfer logic in API
    likerLandFee = estimatedStripeFeeAmount - stripeFee + estimatedLikerLandFeeAmount;
  } else if (hasApplicationFee) {
    // NOTE: Application Fee is deprecated
    likerLandFee = applicationFeeAmount
      - stripeFee - likerLandCommission - likerLandArtFee - likerLandTipFee;
  } else {
    likerLandFee = balanceTxAmount * NFT_BOOK_LIKER_LAND_FEE_RATIO;
  }

  const hasPaidChannelCommission = !!transfers?.find((t) => t.metadata?.type === 'channelCommission');
  const hasPaidConnectedWalletCommission = !!transfers?.find((t) => t.metadata?.type === 'connectedWallet');
  let payableAmount = 0;
  if (hasTransferGroup) {
    if (!hasPaidConnectedWalletCommission) {
      payableAmount = (
        balanceTxAmount
          - stripeFee
          - likerLandFee
          - likerLandCommission
          - likerLandArtFee
          - likerLandTipFee
      );

      if (hasPaidChannelCommission) {
        payableAmount -= channelCommission;
      }
    } else if (!hasPaidChannelCommission) {
      payableAmount = channelCommission;
    }
  } else if (!hasApplicationFee) {
    payableAmount = balanceTxAmount
      - stripeFee - likerLandFee - likerLandCommission - likerLandArtFee - likerLandTipFee;
  }
  const productId = classId || collectionId || '';

  return {
    paymentIntentId: pi.id,
    date: date.toISOString(),

    // Payment
    paymentMethod,
    paymentAmount: pi.amount / 100,
    paymentCurrency: pi.currency,
    balanceTxAmount,
    balanceTxCurrency,
    balanceTxExchangeRate,
    balanceTxNetAmount,
    payableAmount,

    // Fee
    feeTotal,
    applicationFee: applicationFeeAmount,
    transferredAmount,
    stripeFee,
    stripeFeeCurrency,
    likerLandFee,
    likerLandArtFee,
    likerLandTipFee,

    customPriceDiff,

    // Commission
    channel,
    likerLandCommission,
    channelCommission,
    hasApplicationFee,

    // Product
    productId,
    editionIndex,

    // Customer info
    customerEmail,

    utmSource,
    referrer,
    gaClientId,
    gaSessionId,

    rawData: JSON.stringify(pi),
  };
}

export async function createAirtableBookSalesRecordFromStripePaymentIntent({
  pi,
  classId,
  collectionId,
  priceIndex,
  transfers,
  quantity = 1,
  feeInfo,
  shippingCountry,
  shippingCost,
  stripeFeeAmount,
  stripeFeeCurrency,
  from,
}: {
  pi: Stripe.PaymentIntent,
  classId?: string,
  collectionId?: string,
  priceIndex?: number,
  transfers: Stripe.Transfer[],
  quantity?: number,
  feeInfo: any,
  shippingCountry?: string | null,
  shippingCost?: number,
  stripeFeeAmount: number,
  stripeFeeCurrency: string,
  from?: string,
}): Promise<void> {
  try {
    const record = normalizeStripePaymentIntentForAirtableBookSalesRecord({
      classId,
      priceIndex,
      collectionId,
      feeInfo,
      pi,
      transfers,
      from,
      stripeFeeAmount,
      stripeFeeCurrency,
    });
    const fields: Partial<FieldSet> = {
      'Payment Intent ID': record.paymentIntentId,
      Date: record.date,
      Channel: record.channel,
      Edition: record.editionIndex,
      Quantity: quantity,
      'Customer Email': record.customerEmail,
      'Payment Method': record.paymentMethod,
      'Payment Amount': record.paymentAmount,
      'Payment Currency': record.paymentCurrency,
      'Balance Tx Amount': record.balanceTxAmount,
      'Balance Tx Currency': record.balanceTxCurrency,
      'Balance Tx Net Amount': record.balanceTxNetAmount,
      'Balance Tx Exchange Rate': record.balanceTxExchangeRate,
      'Has Application Fee': record.hasApplicationFee,
      'Stripe Fee': record.stripeFee,
      'Stripe Fee Currency': record.stripeFeeCurrency,
      'Application Fee': record.applicationFee,
      'Payable From Liker Land': record.payableAmount,
      'Liker Land Tx Fee': record.likerLandFee,
      'Liker Land Commission': record.likerLandCommission,
      'Liker Land Art Fee': record.likerLandArtFee,
      'Tip Amount': record.customPriceDiff,
      'Liker Land Tip Fee': record.likerLandTipFee,
      'Channel Commission': record.channelCommission,
      'Transferred Amount': record.transferredAmount,
      'UTM Source': record.utmSource,
      'HTTP Referrer': record.referrer,
      'GA Client ID': record.gaClientId,
      'GA Session ID': record.gaSessionId,
      'Raw Data': record.rawData,
    };
    const publicationRecord = await queryAirtablePublicationRecordById(record.productId);
    if (publicationRecord) {
      fields.Product = [publicationRecord.id];
    }
    if (shippingCountry) {
      fields['Shipping Country'] = shippingCountry;
    }
    if (shippingCost) {
      fields['Shipping Cost'] = shippingCost;
    }
    await base(BOOK_SALES_TABLE_NAME).create([{ fields }], { typecast: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}
