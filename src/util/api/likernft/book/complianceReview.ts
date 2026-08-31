import { getVertexGenAIClient } from '../../../vertexAI';
import {
  NFT_BOOK_COMPLIANCE_REVIEW_MODEL,
  NFT_BOOK_COMPLIANCE_REVIEW_PROMPT,
  VERTEX_AI_GEMINI_MODEL,
} from '../../../../../config/config';
import type {
  NFTBookComplianceReviewAction,
  NFTBookComplianceReviewVerdict,
  NFTBookListingInfo,
} from '../../../../types/book';

// Single source of the verdict vocabulary: the unions in types/book.d.ts are
// derived from these arrays, so the runtime checks and the types cannot drift.
export const NFT_BOOK_COMPLIANCE_REVIEW_ACTIONS = [
  'none', 'ads_off', 'geoblock_hk', 'stop_sale_review', 'adult_review',
] as const;

export const HK_RISK_LEVELS = ['none', 'low', 'medium', 'high'] as const;
export const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;

// The deployed config.js overrides the repo one, so a newly added key reads as
// undefined in prod until ops adds it: fall back to the already-deployed model
// key, and repeat its default here since the SDK needs a real model name.
const REVIEW_MODEL = NFT_BOOK_COMPLIANCE_REVIEW_MODEL
  || VERTEX_AI_GEMINI_MODEL || 'gemini-2.5-flash-lite';

const MAX_DESCRIPTION_CHARS = 4000;
const MAX_REASON_CHARS = 1000;
const REVIEW_TIMEOUT_MS = 30000;

export type BookComplianceReviewOutcome =
  | { status: 'skipped' }
  | { status: 'failed' }
  | { status: 'completed'; verdict: NFTBookComplianceReviewVerdict; model: string };

// Not getNameFromMetadata from ./index (which imports this module): also folds
// legacy localized-map contributor values ({ zh, en }) that predate the
// { name } shape.
function contributorToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const valueObj = value as Record<string, unknown>;
    const name = valueObj.name ?? valueObj.zh ?? valueObj.en;
    if (typeof name === 'string') return name;
  }
  return '';
}

// Preliminary AI screen of a new listing's metadata: the verdict picks the
// initial approval flags and is surfaced to admins on Slack. No prompt config
// → skipped; any model failure → non-verdict. Publishing never blocks (fail-open).
export async function reviewBookListingContent({
  name,
  author,
  publisher,
  inLanguage,
  keywords,
  description,
}: {
  name?: string;
  author?: unknown;
  publisher?: unknown;
  inLanguage?: string;
  keywords?: string[];
  description?: string;
}): Promise<BookComplianceReviewOutcome> {
  if (!NFT_BOOK_COMPLIANCE_REVIEW_PROMPT) return { status: 'skipped' };
  try {
    // Type must come via dynamic import: @google/genai is ESM-only to tsc.
    const [client, { Type }] = await Promise.all([
      getVertexGenAIClient(),
      import('@google/genai'),
    ]);
    const authorText = contributorToText(author);
    const publisherText = contributorToText(publisher);
    const bookBlock = [
      `Title: ${name || ''}`,
      authorText ? `Author: ${authorText}` : '',
      publisherText ? `Publisher: ${publisherText}` : '',
      inLanguage ? `Language: ${inLanguage}` : '',
      keywords?.length ? `Keywords: ${keywords.join(', ')}` : '',
      description ? `Description:\n${description.slice(0, MAX_DESCRIPTION_CHARS)}` : '',
    ].filter(Boolean).join('\n');

    const response = await client.models.generateContent({
      model: REVIEW_MODEL,
      contents: bookBlock,
      config: {
        systemInstruction: NFT_BOOK_COMPLIANCE_REVIEW_PROMPT,
        // A bounded thinking budget helps borderline calls; unbounded thinking
        // on a flash-tier model can eat the output budget.
        thinkingConfig: { thinkingBudget: 512 },
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: [...NFT_BOOK_COMPLIANCE_REVIEW_ACTIONS] },
            hkRisk: { type: Type.STRING, enum: [...HK_RISK_LEVELS] },
            adult: { type: Type.BOOLEAN },
            copyrightFlag: { type: Type.BOOLEAN },
            confidence: { type: Type.STRING, enum: [...CONFIDENCE_VALUES] },
            // "Pass but ping": the listing publishes under `action`, but admins
            // are asked to take a second look (privacy, spam, borderline adult…).
            needsHumanReview: { type: Type.BOOLEAN },
            reason: { type: Type.STRING },
          },
          required: ['action', 'hkRisk', 'adult', 'copyrightFlag', 'confidence', 'needsHumanReview', 'reason'],
        },
      },
    });
    const { text } = response;
    if (!text) throw new Error('empty model response');
    // responseSchema does not guarantee parseable output: hitting
    // maxOutputTokens truncates the JSON mid-string.
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`unparseable model response: ${text.slice(0, 200)}`);
    }
    if (!NFT_BOOK_COMPLIANCE_REVIEW_ACTIONS.includes(parsed.action)) {
      throw new Error(`invalid verdict action: ${parsed.action}`);
    }
    const verdict: NFTBookComplianceReviewVerdict = {
      action: parsed.action,
      hkRisk: HK_RISK_LEVELS.includes(parsed.hkRisk) ? parsed.hkRisk : 'none',
      adult: !!parsed.adult,
      copyrightFlag: !!parsed.copyrightFlag,
      confidence: CONFIDENCE_VALUES.includes(parsed.confidence) ? parsed.confidence : 'low',
      needsHumanReview: !!parsed.needsHumanReview,
      reason: String(parsed.reason || '').slice(0, MAX_REASON_CHARS),
    };
    return { status: 'completed', verdict, model: REVIEW_MODEL };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('reviewBookListingContent failed:', err);
    return { status: 'failed' };
  }
}

// Verdicts whose Slack notification always asks for a second look, even when
// the model did not: geoblock_hk applies a user-visible purchase restriction
// with no human read (undo: `/book approve <classId> clear_geoblock`).
export const FORCE_PING_REVIEW_ACTIONS: NFTBookComplianceReviewAction[] = ['geoblock_hk'];

// An HK geoblock implies CN. Shared with the Slack `/book approve <classId> geoblock` lever.
export const GEOBLOCK_HK_TERRITORIES = ['HK', 'CN'];

// Restrict-only initial-flag overrides per verdict. stop_sale_review mirrors
// the Slack /book `pending_review` combo (src/routes/slack/book.ts) so admins
// release it with `/book approve`; the others only withhold ads plus their tag.
export function getListingFlagOverridesForReviewAction(
  action: NFTBookComplianceReviewAction,
): Partial<NFTBookListingInfo> {
  switch (action) {
    case 'ads_off':
      return { isApprovedForAds: false, approvalStatus: 'pending' };
    case 'geoblock_hk':
      return {
        isApprovedForAds: false,
        approvalStatus: 'pending',
        restrictedTerritories: GEOBLOCK_HK_TERRITORIES,
      };
    case 'adult_review':
      return { isApprovedForAds: false, approvalStatus: 'pending', isAdultOnly: true };
    case 'stop_sale_review':
      return {
        isPendingReview: true,
        isApprovedForSale: false,
        isApprovedForIndexing: false,
        isApprovedForAds: false,
        approvalStatus: 'pending_review',
      };
    case 'none':
    default:
      return {};
  }
}
