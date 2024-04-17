import Airtable, { FieldSet } from 'airtable';
import Stripe from 'stripe';

import {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
} from '../../config/config';

import { NFT_BOOK_DEFAULT_FROM_CHANNEL } from '../constant';

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
  iscnObject,
  metadata,
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
  iscnIdPrefix?: string;
  iscnObject?: any;
  metadata?: any;
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
    };

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

function normalizeStripePaymentIntentForAirtableBookSalesRecord(pi: Stripe.PaymentIntent) {
  const {
    from: channel,
    classId,
    collectionId,
    priceIndex: priceIndexRaw,
    likerLandArtFee: likerLandArtFeeRaw = '0',
    utmSource,
    gaClientId,
    gaSessionId,
  } = pi.metadata;

  const date = new Date(pi.created * 1000);

  let customerEmail = '';
  let paymentMethod = 'unknown';
  let balanceTxAmount = 0;
  let balanceTxCurrency: string | undefined;
  let balanceTxExchangeRate: number | undefined;
  let balanceTxNetAmount = 0;
  let stripeFee = 0;
  let stripeFeeCurrency = 'usd';
  let feeTotal = 0;

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
      balanceTxAmount = balanceTx.amount / 100;
      balanceTxNetAmount = balanceTx.net / 100;
      balanceTxCurrency = balanceTx.currency;
      balanceTxExchangeRate = balanceTx.exchange_rate || undefined;

      const stripeFeeDetails = balanceTx.fee_details.find((fee) => fee.type === 'stripe_fee');
      if (stripeFeeDetails) {
        stripeFee = stripeFeeDetails.amount / 100;
        stripeFeeCurrency = stripeFeeDetails.currency;
      }

      feeTotal = balanceTx.fee / 100;
    }
  }

  const editionIndex = priceIndexRaw ? Number(priceIndexRaw) : 0;

  const withStripeConnect = !!pi.transfer_data;

  const isAppliedStripeConnectCommissionFix = true;

  const channelCommission = balanceTxAmount * NFT_BOOK_LIKER_LAND_COMMISSION_RATIO;

  const isLikerLandChannel = channel === NFT_BOOK_DEFAULT_FROM_CHANNEL;

  const likerLandCommission = isLikerLandChannel ? channelCommission : 0;

  const likerLandArtFee = Number(likerLandArtFeeRaw) / 100;

  const otherCommission = !withStripeConnect && !isLikerLandChannel ? channelCommission : 0;

  // NOTE: Liker Land commission is included in the application fee after the commission fix date
  const applicationFee = pi.application_fee_amount ? pi.application_fee_amount / 100 : 0;
  const likerLandFee = withStripeConnect
    ? applicationFee - stripeFee - likerLandCommission - likerLandArtFee
    : balanceTxAmount * NFT_BOOK_LIKER_LAND_FEE_RATIO;

  // NOTE: We have to collect commission for tx with Stripe Connect before the commission fix date
  const receivableAmount = (
    isLikerLandChannel && withStripeConnect && !isAppliedStripeConnectCommissionFix
      ? likerLandCommission
      : 0
  );

  const payableAmount = !withStripeConnect
    ? balanceTxAmount - stripeFee - likerLandFee - likerLandCommission - likerLandArtFee
    : 0;

  return {
    id: pi.id,
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
    receivableAmount,

    // Fee
    feeTotal,
    applicationFee,
    stripeFee,
    stripeFeeCurrency,
    likerLandFee,
    likerLandArtFee,

    // Commission
    channel,
    likerLandCommission,
    otherCommission,
    isStripeConnect: withStripeConnect,

    // Product
    productId: classId || collectionId,
    editionIndex,

    // Customer info
    customerEmail,

    utmSource,
    gaClientId,
    gaSessionId,

    rawData: JSON.stringify(pi),
  };
}

export async function createAirtableBookSalesRecordFromStripePaymentIntent(
  pi: Stripe.PaymentIntent,
): Promise<void> {
  try {
    const record = normalizeStripePaymentIntentForAirtableBookSalesRecord(pi);
    const fields: Partial<FieldSet> = {
      ID: record.id,
      Date: record.date,
      Channel: record.channel,
      Edition: record.editionIndex,
      'Customer Email': record.customerEmail,
      'Payment Method': record.paymentMethod,
      'Payment Amount': record.paymentAmount,
      'Payment Currency': record.paymentCurrency,
      'Balance Tx Amount': record.balanceTxAmount,
      'Balance Tx Currency': record.balanceTxCurrency,
      'Balance Tx Net Amount': record.balanceTxNetAmount,
      'Balance Tx Exchange Rate': record.balanceTxExchangeRate,
      'Stripe Connected': record.isStripeConnect,
      'Stripe Fee': record.stripeFee,
      'Stripe Fee Currency': record.stripeFeeCurrency,
      'Application Fee': record.applicationFee,
      'Payable From Liker Land': record.payableAmount,
      'Liker Land Tx Fee': record.likerLandFee,
      'Liker Land Commission': record.likerLandCommission,
      'Liker Land Art Fee': record.likerLandArtFee,
      'Other Commission': record.otherCommission,
      'Payable To Liker Land': record.receivableAmount,
      'UTM Source': record.utmSource,
      'GA Client ID': record.gaClientId,
      'GA Session ID': record.gaSessionId,
      'Raw Data': record.rawData,
    };
    const publicationRecord = await queryAirtablePublicationRecordById(record.productId);
    if (publicationRecord) {
      fields.Product = [publicationRecord.id];
    }
    await base(BOOK_SALES_TABLE_NAME).create([{ fields }], { typecast: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}
