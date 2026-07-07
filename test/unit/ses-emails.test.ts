import {
  describe, it, expect, beforeEach, afterEach, vi, type MockInstance,
} from 'vitest';
import {
  ses,
  sendVerificationEmail,
  sendNFTBookListingEmail,
  sendNFTBookPendingClaimEmail,
  sendNFTBookCartPendingClaimEmail,
  sendNFTBookGiftPendingClaimEmail,
  sendNFTBookCartGiftPendingClaimEmail,
  sendNFTBookGiftClaimedEmail,
  sendNFTBookGiftSentEmail,
  sendNFTBookManualDeliverSentEmail,
  sendAutoDeliverNFTBookSalesEmail,
  sendNFTBookSalePaymentsEmail,
  sendManualNFTBookSalesEmail,
  sendNFTBookOutOfStockEmail,
  sendPlusBookPromoCodeEmail,
  sendPlusGiftPendingClaimEmail,
  sendPlusGiftClaimedEmail,
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

  it('sendVerificationEmail builds expected params', async () => {
    const res = {
      // eslint-disable-next-line no-underscore-dangle
      __: (key: string, args?: Record<string, string>) => (args ? `${key} ${JSON.stringify(args)}` : key),
    };
    await sendVerificationEmail(
      res,
      { email: 'user@example.com', displayName: 'User', verificationUUID: 'uuid-123' },
      'ref-1',
    );
    expect(lastParams()).toMatchSnapshot();
  });

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

    it(`sendAutoDeliverNFTBookSalesEmail builds expected params (${language})`, async () => {
      await sendAutoDeliverNFTBookSalesEmail({
        email: 'author@example.com',
        classId: '0xclass',
        paymentId: 'payment-1',
        claimerEmail: 'claimer@example.com',
        buyerEmail: 'buyer@example.com',
        bookName: 'My Book',
        feeInfo,
        wallet: '0xwallet',
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
        wallet: '0xwallet',
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
      wallet: '0xwallet',
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
      wallet: '0xwallet',
    });
    const params = lastParams() as { Destination?: { ToAddresses?: string[] } };
    expect(params.Destination).not.toHaveProperty('ToAddresses');
    expect(params).toMatchSnapshot();
  });
});
