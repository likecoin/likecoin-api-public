import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
// Mutable so one file covers both the configured and unconfigured states; the
// util reads the config binding at call time.
const cfg = vi.hoisted(() => ({ prompt: 'test system prompt' }));

vi.mock('@google/genai', () => ({
  Type: {
    OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN',
  },
}));

vi.mock('../../src/util/vertexAI', () => ({
  getVertexGenAIClient: vi.fn(async () => ({ models: { generateContent } })),
}));

vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal() as object),
  get NFT_BOOK_COMPLIANCE_REVIEW_PROMPT() { return cfg.prompt; },
  NFT_BOOK_COMPLIANCE_REVIEW_MODEL: 'test-model',
}));

// eslint-disable-next-line import/first
import {
  getListingFlagOverridesForReviewAction,
  reviewBookListingContent,
} from '../../src/util/api/likernft/book/complianceReview';

const VALID_VERDICT = {
  action: 'geoblock_hk',
  hkRisk: 'high',
  adult: false,
  copyrightFlag: false,
  confidence: 'high',
  needsHumanReview: false,
  reason: 'test reason',
};

describe('reviewBookListingContent', () => {
  beforeEach(() => {
    cfg.prompt = 'test system prompt';
    generateContent.mockReset();
  });

  it('skips without calling the model when the prompt is unconfigured', async () => {
    cfg.prompt = '';
    const outcome = await reviewBookListingContent({ name: 'Book' });
    expect(outcome).toEqual({ status: 'skipped' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('returns the parsed verdict and echoes the configured model', async () => {
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(VALID_VERDICT) });
    const outcome = await reviewBookListingContent({
      name: 'Book',
      author: { name: 'Author A' },
      publisher: '出版社',
      inLanguage: 'zh',
      keywords: ['k1', 'k2'],
      description: 'About the book',
    });
    expect(outcome).toEqual({ status: 'completed', verdict: VALID_VERDICT, model: 'test-model' });

    const [{ contents, config, model }] = generateContent.mock.calls[0];
    expect(model).toBe('test-model');
    expect(contents).toContain('Title: Book');
    expect(contents).toContain('Author: Author A');
    expect(contents).toContain('Publisher: 出版社');
    expect(contents).toContain('Keywords: k1, k2');
    expect(contents).toContain('About the book');
    expect(config.systemInstruction).toBe('test system prompt');
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 512 });
    expect(config.responseMimeType).toBe('application/json');
  });

  it('fails open when the model call rejects', async () => {
    generateContent.mockRejectedValueOnce(new Error('vertex down'));
    await expect(reviewBookListingContent({ name: 'Book' }))
      .resolves.toEqual({ status: 'failed' });
  });

  it('fails open on empty or unparseable responses', async () => {
    generateContent.mockResolvedValueOnce({ text: '' });
    await expect(reviewBookListingContent({ name: 'Book' }))
      .resolves.toEqual({ status: 'failed' });

    generateContent.mockResolvedValueOnce({ text: 'not json' });
    await expect(reviewBookListingContent({ name: 'Book' }))
      .resolves.toEqual({ status: 'failed' });
  });

  it('fails open on a verdict action outside the enum', async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ ...VALID_VERDICT, action: 'nuke_from_orbit' }),
    });
    await expect(reviewBookListingContent({ name: 'Book' }))
      .resolves.toEqual({ status: 'failed' });
  });

  it('coerces malformed advisory fields instead of failing', async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: 'none', hkRisk: 'apocalyptic', adult: 'yes', copyrightFlag: 0, confidence: '?', reason: 42,
      }),
    });
    const outcome = await reviewBookListingContent({ name: 'Book' });
    expect(outcome).toMatchObject({
      status: 'completed',
      verdict: {
        action: 'none',
        hkRisk: 'none',
        adult: true,
        copyrightFlag: false,
        confidence: 'low',
        needsHumanReview: false,
        reason: '42',
      },
    });
  });

  it('passes through a pass-but-ping verdict', async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ ...VALID_VERDICT, action: 'none', needsHumanReview: true }),
    });
    const outcome = await reviewBookListingContent({ name: 'Book' });
    expect(outcome).toMatchObject({
      status: 'completed',
      verdict: { action: 'none', needsHumanReview: true },
    });
  });
});

describe('getListingFlagOverridesForReviewAction', () => {
  it.each([
    ['none', {}],
    ['ads_off', { isApprovedForAds: false, approvalStatus: 'pending' }],
    ['geoblock_hk', {
      isApprovedForAds: false,
      approvalStatus: 'pending',
      restrictedTerritories: ['HK', 'CN'],
    }],
    ['adult_review', { isApprovedForAds: false, approvalStatus: 'pending', isAdultOnly: true }],
    ['stop_sale_review', {
      isPendingReview: true,
      isApprovedForSale: false,
      isApprovedForIndexing: false,
      isApprovedForAds: false,
      approvalStatus: 'pending_review',
    }],
  ] as const)('%s', (action, expected) => {
    expect(getListingFlagOverridesForReviewAction(action)).toEqual(expected);
  });
});
