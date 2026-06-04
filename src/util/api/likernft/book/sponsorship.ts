import { z } from 'zod';
import { base, baseSepolia } from 'viem/chains';

import { IS_TESTNET } from '../../../../constant';
import { ALCHEMY_GAS_POLICY_ID } from '../../../../../config/config';
import { isRegisteredEVMWallet } from '../../wallet';

const EXPECTED_CHAIN_ID = (IS_TESTNET ? baseSepolia : base).id;

// Every field tolerates unexpected shapes so validateBody never 400s: a non-object
// body is coerced to {}, and any field that fails to parse falls back to undefined.
// The decision is then made by evaluateSponsorship (an explicit 200 { approved:
// false }) rather than 400-ing into Alchemy's approveOnFailure (fail-open) path.
export const VerifySchema = z.preprocess(
  (val) => (typeof val === 'object' && val !== null && !Array.isArray(val) ? val : {}),
  z.object({
    userOperation: z.object({ sender: z.string().optional() }).passthrough()
      .optional().catch(undefined),
    policyId: z.string().optional().catch(undefined),
    chainId: z.union([z.string(), z.number()]).optional().catch(undefined),
    webhookData: z.string().optional().catch(undefined),
  }).passthrough(),
);

type SponsorshipReason =
  | 'POLICY_MISMATCH'
  | 'CHAIN_MISMATCH'
  | 'NO_SENDER'
  | 'NOT_REGISTERED'
  | 'REGISTERED';

interface SponsorshipDecision {
  approved: boolean;
  reason: SponsorshipReason;
}

// Tier A gate: sponsor only operations whose sender is a registered likerId user
// (present in userCollection), on the expected chain, for our policy. Returns a
// decision (never throws on a rejection — the caller must surface it as HTTP 200
// { approved: false }).
export async function evaluateSponsorship(
  body: z.infer<typeof VerifySchema>,
): Promise<SponsorshipDecision> {
  const { userOperation, policyId, chainId } = body;

  // Defence-in-depth: only enforce policy match when a policy id is configured,
  // so a missing env never silently blocks all sponsorship.
  if (ALCHEMY_GAS_POLICY_ID && policyId !== ALCHEMY_GAS_POLICY_ID) {
    return { approved: false, reason: 'POLICY_MISMATCH' };
  }

  if (Number(chainId) !== EXPECTED_CHAIN_ID) {
    return { approved: false, reason: 'CHAIN_MISMATCH' };
  }

  const sender = userOperation?.sender;
  if (!sender) {
    return { approved: false, reason: 'NO_SENDER' };
  }

  const isRegistered = await isRegisteredEVMWallet(sender);
  return isRegistered
    ? { approved: true, reason: 'REGISTERED' }
    : { approved: false, reason: 'NOT_REGISTERED' };
}

export default evaluateSponsorship;
