import {
  describe, it, expect, beforeEach, afterEach, vi, type MockInstance,
} from 'vitest';
import {
  ses,
  sendNFTBookListingEmail,
  sendNFTBookPendingClaimEmail,
  sendNFTBookCartPendingClaimEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookCartGiftPendingClaimEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookManualDeliverSentEmail,
  sendNFTBookMerchShippedEmail,
  sendNFTBookMerchOrderReceivedEmail,
  sendNFTBookMerchSaleEmail,
  sendAutoDeliverNFTBookSalesEmail,
  sendNFTBookSalePaymentsEmail,
  sendManualNFTBookSalesEmail,
  sendNFTBookOutOfStockEmail,
  sendPlusBookPromoCodeEmail,
  sendPlusGiftPendingClaimEmail,
  sendPlusGiftClaimedEmail,
  sendVerificationEmail,
} from '../../src/util/ses';
import type { TransactionFeeInfo } from '../../src/util/api/likernft/book/type';

const feeInfo: TransactionFeeInfo = {
  priceInDecimal: 1090,
  originalPriceInDecimal: 900,
  stripeFeeAmount: 40,
  likerLandTipFeeAmount: 10,
  likerLandFeeAmount: 60,
  likerLandCommission: 90,
  channelCommission: 50,
  likerLandArtFee: 0,
  customPriceDiffInDecimal: 100,
  royaltyToSplit: 400,
};

describe('SES email params', () => {
  let sendEmailSpy: MockInstance;

  beforeEach(() => {
    sendEmailSpy = vi.spyOn(ses, 'sendEmail')
      .mockImplementation((() => Promise.resolve({})) as never);
    // Re-spying returns the same spy; clear explicitly so call counts don't
    // depend on the global clearAllMocks in test/setup.ts.
    sendEmailSpy.mockClear();
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
  });

  function lastParams() {
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    return sendEmailSpy.mock.calls[0][0];
  }

  it('sendNFTBookListingEmail builds expected params', async () => {
    await sendNFTBookListingEmail({ classId: '0xclass', bookName: 'My Book' });
    expect(lastParams()).toMatchSnapshot();
  });

  ['en', 'zh'].forEach((language) => {
    it(`sendNFTBookPendingClaimEmail builds expected params (${language})`, async () => {
      await sendNFTBookPendingClaimEmail({
        email: 'reader@example.com',
        classId: '0xclass',
        bookName: 'My Book',
        paymentId: 'payment-1',
        claimToken: 'token-1',
        from: 'channel-1',
        isResend: true,
        displayName: 'Reader',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookCartPendingClaimEmail builds expected params (${language})`, async () => {
      await sendNFTBookCartPendingClaimEmail({
        cartId: 'cart-1',
        bookNames: ['Book A', 'Book B'],
        paymentId: 'payment-1',
        claimToken: 'token-1',
        displayName: 'Reader',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookGiftPendingClaimEmail builds expected params (${language})`, async () => {
      await sendNFTBookGiftPendingClaimEmail({
        fromName: 'Sender',
        toName: 'Receiver',
        toEmail: 'receiver@example.com',
        message: 'Enjoy!',
        classId: '0xclass',
        bookName: 'My Book',
        paymentId: 'payment-1',
        claimToken: 'token-1',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookCartGiftPendingClaimEmail builds expected params (${language})`, async () => {
      await sendNFTBookCartGiftPendingClaimEmail({
        fromName: 'Sender',
        toName: 'Receiver',
        toEmail: 'receiver@example.com',
        message: 'Enjoy!',
        cartId: 'cart-1',
        bookNames: ['Book A', 'Book B'],
        paymentId: 'payment-1',
        claimToken: 'token-1',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookGiftClaimedEmail builds expected params (${language})`, async () => {
      await sendNFTBookGiftClaimedEmail({
        bookName: 'My Book',
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        toName: 'Receiver',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookGiftSentEmail builds expected params (${language})`, async () => {
      await sendNFTBookGiftSentEmail({
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        toName: 'Receiver',
        bookName: 'My Book',
        txHash: '0xtxhash',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookManualDeliverSentEmail builds expected params (${language})`, async () => {
      await sendNFTBookManualDeliverSentEmail({
        email: 'reader@example.com',
        classId: '0xclass',
        bookName: 'My Book',
        txHash: '0xtxhash',
        displayName: 'Reader',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookMerchShippedEmail builds expected params (${language})`, async () => {
      await sendNFTBookMerchShippedEmail({
        email: 'buyer@example.com',
        productName: 'Boox Go 7',
        trackingNumber: 'SF<123>',
        displayName: 'Buyer',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookMerchShippedEmail escapes the buyer name and product name (${language})`, async () => {
      await sendNFTBookMerchShippedEmail({
        email: 'buyer@example.com',
        productName: 'Reader <b>X</b>',
        displayName: '<img src=x onerror=alert(1)>',
        language,
      });
      const html = (lastParams() as any).Message.Body.Html.Data as string;
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<b>X</b>');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    const shippingDetails = {
      name: 'Chan <Tai Man>',
      phone: '+85291234567',
      address: {
        line1: '1 Queen\'s Road',
        line2: null,
        city: 'Hong Kong',
        state: null,
        postal_code: null,
        country: 'HK',
      },
    };

    it(`sendNFTBookMerchOrderReceivedEmail builds expected params (${language})`, async () => {
      await sendNFTBookMerchOrderReceivedEmail({
        email: 'buyer@example.com',
        paymentId: 'payment-1',
        items: [{ name: 'Boox Go 7', quantity: 1 }],
        amountTotal: 169800,
        currency: 'hkd',
        shippingDetails,
        displayName: 'Buyer',
        language,
      });
      const params = lastParams() as any;
      expect(params.Message.Body.Html.Data).toContain('HKD 1698.00');
      expect(params.Message.Body.Html.Data).toContain('Chan &lt;Tai Man&gt;');
      expect(params).toMatchSnapshot();
    });

    it(`sendNFTBookMerchSaleEmail builds expected params (${language})`, async () => {
      await sendNFTBookMerchSaleEmail({
        email: 'store@example.com',
        classId: '0xclass',
        paymentId: 'payment-1',
        productName: 'Boox Go 7',
        quantity: 1,
        buyerEmail: 'buyer@example.com',
        shippingDetails,
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookMerchShippedEmail omits an empty tracking number (${language})`, async () => {
      await sendNFTBookMerchShippedEmail({
        email: 'buyer@example.com',
        productName: 'Boox Go 7',
        language,
      });
      const html = (lastParams() as any).Message.Body.Html.Data as string;
      expect(html).not.toMatch(/Tracking number|追蹤編號/);
    });

    it(`sendAutoDeliverNFTBookSalesEmail builds expected params (${language})`, async () => {
      await sendAutoDeliverNFTBookSalesEmail({
        email: 'author@example.com',
        classId: '0xclass',
        paymentId: 'payment-1',
        claimerEmail: 'claimer@example.com',
        buyerEmail: 'buyer@example.com',
        bookName: 'My Book',
        feeInfo,
        coupon: 'COUPON',
        from: 'channel-1',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookSalePaymentsEmail builds expected params (${language})`, async () => {
      await sendNFTBookSalePaymentsEmail({
        classId: '0xclass',
        paymentId: 'payment-1',
        email: 'author@example.com',
        bookName: 'My Book',
        payments: [
          { type: 'connectedWallet', amount: 4 },
          { type: 'channelCommission', amount: 0.5 },
        ],
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendManualNFTBookSalesEmail builds expected params (${language})`, async () => {
      await sendManualNFTBookSalesEmail({
        email: 'author@example.com',
        classId: '0xclass',
        paymentId: 'payment-1',
        claimerEmail: 'claimer@example.com',
        buyerEmail: 'buyer@example.com',
        bookName: 'My Book',
        feeInfo,
        coupon: 'COUPON',
        from: 'channel-1',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendNFTBookOutOfStockEmail builds expected params (${language})`, async () => {
      await sendNFTBookOutOfStockEmail({
        email: 'author@example.com',
        classId: '0xclass',
        bookName: 'My Book',
        priceName: 'Standard',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendPlusBookPromoCodeEmail builds expected params (${language})`, async () => {
      await sendPlusBookPromoCodeEmail({
        email: 'reader@example.com',
        code: 'PROMO123',
        bookNames: ['Book A', 'Book B'],
        displayName: 'Reader',
        ownerDisplayName: 'Publisher',
        voiceName: 'Voice',
        language,
        currency: 'twd',
        fromLikerId: 'publisherid',
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendPlusGiftPendingClaimEmail builds expected params (${language})`, async () => {
      await sendPlusGiftPendingClaimEmail({
        fromName: 'Sender',
        fromEmail: 'sender@example.com',
        toName: 'Receiver',
        toEmail: 'receiver@example.com',
        message: 'Enjoy!',
        cartId: 'cart-1',
        paymentId: 'payment-1',
        claimToken: 'token-1',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });

    it(`sendPlusGiftClaimedEmail builds expected params (${language})`, async () => {
      await sendPlusGiftClaimedEmail({
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        toName: 'Receiver',
        language,
      });
      expect(lastParams()).toMatchSnapshot();
    });
  });

  it('sendAutoDeliverNFTBookSalesEmail omits ToAddresses when email is empty', async () => {
    await sendAutoDeliverNFTBookSalesEmail({
      email: '',
      classId: '0xclass',
      paymentId: 'payment-1',
      claimerEmail: 'claimer@example.com',
      buyerEmail: 'claimer@example.com',
      bookName: 'My Book',
      feeInfo,
    });
    const params = lastParams() as { Destination?: { ToAddresses?: string[] } };
    expect(params.Destination).not.toHaveProperty('ToAddresses');
    expect(params).toMatchSnapshot();
  });

  it('sendManualNFTBookSalesEmail omits ToAddresses when email is empty', async () => {
    await sendManualNFTBookSalesEmail({
      email: '',
      classId: '0xclass',
      paymentId: 'payment-1',
      claimerEmail: 'claimer@example.com',
      buyerEmail: 'claimer@example.com',
      bookName: 'My Book',
      feeInfo,
    });
    const params = lastParams() as { Destination?: { ToAddresses?: string[] } };
    expect(params.Destination).not.toHaveProperty('ToAddresses');
    expect(params).toMatchSnapshot();
  });

  describe('publisher order email amount table', () => {
    async function getAmountTable(
      overrides: Partial<TransactionFeeInfo>,
      { language = 'zh', from }: { language?: string; from?: string } = {},
    ) {
      await sendAutoDeliverNFTBookSalesEmail({
        email: 'author@example.com',
        classId: '0xclass',
        paymentId: 'payment-1',
        claimerEmail: 'claimer@example.com',
        buyerEmail: 'claimer@example.com',
        bookName: 'My Book',
        feeInfo: { ...feeInfo, ...overrides },
        from,
        language,
      });
      const html = (lastParams() as any).Message.Body.Html.Data as string;
      return html.match(/<table>.*?<\/table>/)?.[0] ?? '';
    }

    ['en', 'zh'].forEach((language) => {
      it(`hides original price when it equals the price (${language})`, async () => {
        const table = await getAmountTable(
          { priceInDecimal: 900, customPriceDiffInDecimal: 0 },
          { language },
        );
        expect(table).toContain('USD 9.00</td>');
        expect(table).not.toMatch(/original|原價/);
      });
    });

    it('shows original price when there is FX variance', async () => {
      const table = await getAmountTable({
        priceInDecimal: 994,
        originalPriceInDecimal: 999,
        customPriceDiffInDecimal: 0,
      });
      expect(table).toContain('USD 9.94（包含讀者貨幣的滙率差。原價：USD 9.99）');
    });
  });

  // The link is the whole verification flow, so pin its shape: host, path, and
  // the `lang` a GET from a mail client has no other way to carry.
  it('sendVerificationEmail links straight at the API with the sender locale', async () => {
    const res = {
      __: (key: string, args?: Record<string, string>) => (args ? `${key} ${JSON.stringify(args)}` : key),
      getLocale: () => 'en',
    };
    await sendVerificationEmail(res as never, {
      email: 'user@example.com',
      displayName: 'User',
      verificationUUID: 'uuid-123',
    });
    const params = lastParams() as {
      Source: string;
      Destination: { ToAddresses: string[] };
      Message: { Body: { Html: { Data: string } } };
    };
    expect(params.Source).toBe('"3ook.com" <cs@3ook.com>');
    expect(params.Destination.ToAddresses).toEqual(['user@example.com']);
    const html = params.Message.Body.Html.Data;
    expect(html).toContain('https://api.rinkeby.like.co/email/verify/uuid-123?lang=en');
    expect(html).not.toContain('like.co/verify/');
  });
});
