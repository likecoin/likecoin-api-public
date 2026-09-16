import { describe, it, expect } from 'vitest';
import { updatePlusPendingTier } from '../../src/util/api/plus';
import { userCollection } from '../../src/util/firebase';
import type { LikerPlusData } from '../../src/types/user';

const PERIOD_START = Date.now();
const PERIOD_END = PERIOD_START + 30 * 24 * 60 * 60 * 1000;

async function seedSubscriber(likerId: string, likerPlus: Partial<LikerPlusData>) {
  await userCollection.doc(likerId).set({
    email: `${likerId}@example.com`,
    likerPlus: {
      period: 'year',
      since: PERIOD_START,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      subscriptionStatus: 'active',
      subscriptionId: 'sub_test',
      ...likerPlus,
    },
  });
}

async function readPendingTier(likerId: string) {
  const doc = await userCollection.doc(likerId).get();
  return (doc.data()?.likerPlus as LikerPlusData | undefined)?.pendingTier;
}

describe('updatePlusPendingTier', () => {
  it('marks a Civic -> Plus downgrade as pending', async () => {
    await seedSubscriber('downgrader', { tier: 'civic' });
    await updatePlusPendingTier('downgrader', { currentTier: 'civic', targetTier: 'plus' });
    expect(await readPendingTier('downgrader')).toBe('plus');
  });

  it('clears the marker when the downgrade is undone', async () => {
    await seedSubscriber('undoer', { tier: 'civic', pendingTier: 'plus' });
    await updatePlusPendingTier('undoer', {
      currentTier: 'civic',
      targetTier: 'civic',
      pendingTier: 'plus',
    });
    expect(await readPendingTier('undoer')).toBeUndefined();
  });

  it('leaves an already-correct marker in place when the downgrade is repeated', async () => {
    await seedSubscriber('repeater', { tier: 'civic', pendingTier: 'plus' });
    await updatePlusPendingTier('repeater', {
      currentTier: 'civic',
      targetTier: 'plus',
      pendingTier: 'plus',
    });
    expect(await readPendingTier('repeater')).toBe('plus');
  });

  it('leaves no marker on a Plus -> Civic upgrade, which applies immediately', async () => {
    await seedSubscriber('upgrader', { tier: 'plus' });
    await updatePlusPendingTier('upgrader', { currentTier: 'plus', targetTier: 'civic' });
    expect(await readPendingTier('upgrader')).toBeUndefined();
  });

  it('leaves no marker on a same-tier period change', async () => {
    await seedSubscriber('periodswitcher', { tier: 'civic' });
    await updatePlusPendingTier('periodswitcher', { currentTier: 'civic', targetTier: 'civic' });
    expect(await readPendingTier('periodswitcher')).toBeUndefined();
  });
});
