import { z } from 'zod';
import {
  MIN_BOOK_PRICE_DECIMAL,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
} from '../../../../constant';
import { BOOK_PRICE_OVERRIDE_CURRENCIES } from '../../../pricing';

const LocalizedTextMap = z.record(z.string(), z.string())
  .refine(
    (m) => typeof m[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string',
    { message: `default locale "${NFT_BOOK_TEXT_DEFAULT_LOCALE}" is required` },
  );

const PriceInDecimalByCurrencySchema = z.object(
  Object.fromEntries(
    BOOK_PRICE_OVERRIDE_CURRENCIES.map((currency) => [
      currency,
      z.number().int().min(0),
    ]),
  ),
).partial();

export const NFTBookPriceSchema = z.object({
  priceInDecimal: z.number()
    .int()
    .min(0)
    .refine(
      (v) => v === 0 || v >= MIN_BOOK_PRICE_DECIMAL,
      { message: `priceInDecimal must be 0 or >= ${MIN_BOOK_PRICE_DECIMAL}` },
    ),
  priceInDecimalByCurrency: PriceInDecimalByCurrencySchema.optional(),
  stock: z.number().int().min(0),
  name: LocalizedTextMap,
  description: LocalizedTextMap,
  isAllowCustomPrice: z.boolean().optional(),
  isAutoDeliver: z.boolean().optional(),
  isUnlisted: z.boolean().optional(),
  autoMemo: z.string().optional(),
  order: z.number().int().optional(),
});

export const NFTBookPricesSchema = z.array(NFTBookPriceSchema).min(1);

export const PriceMutationBodySchema = z.object({
  price: NFTBookPriceSchema,
});

export const PriceReorderBodySchema = z.object({
  order: z.coerce.number().int().min(0),
});

const ConnectedWalletsSchema = z.record(z.string(), z.number().int().min(0));

export const ListingSettingsBodySchema = z.object({
  moderatorWallets: z.array(z.string()).optional(),
  connectedWallets: ConnectedWalletsSchema.nullish(),
  mustClaimToView: z.boolean().optional(),
  hideDownload: z.boolean().optional(),
  hideAudio: z.boolean().optional(),
  hideUpsell: z.boolean().optional(),
  enableCustomMessagePage: z.boolean().optional(),
  tableOfContents: z.string().optional(),
  isAdultOnly: z.boolean().optional(),
  isPlusReadingEnabled: z.boolean().optional(),
});

export const NewListingBodySchema = ListingSettingsBodySchema.extend({
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
  prices: NFTBookPricesSchema,
});

export const ImageUploadBodySchema = z.object({
  signedMessageText: z.string().optional(),
});
