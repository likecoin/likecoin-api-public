import { describe, it, expect } from 'vitest';
import { mapAttributionExtraProperties } from '../../src/util/api/plus/index';

// This mapper is the single place both conversion paths (Stripe webhook and the
// RevenueCat webhook) turn stored attribution into PostHog event properties, so the
// key names here are the analytics contract — renaming one breaks both at once.
describe('mapAttributionExtraProperties', () => {
  it('maps last-touch and first-touch attribution to their event property names', () => {
    expect(mapAttributionExtraProperties({
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'aug-push',
      utmContent: 'hero',
      utmTerm: 'ebook',
      initialUtmSource: 'facebookads',
      initialUtmMedium: 'paid_social',
      initialUtmCampaign: 'launch',
      from: 'plus-modal',
    })).toEqual({
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'aug-push',
      utm_content: 'hero',
      utm_term: 'ebook',
      initial_utm_source: 'facebookads',
      initial_utm_medium: 'paid_social',
      initial_utm_campaign: 'launch',
      channel: 'plus-modal',
    });
  });

  it('leaves first-touch keys undefined when the client sent none', () => {
    // The pre-first-touch clients (and every subscription created before this
    // shipped) carry no initialUtm* metadata; those keys must stay absent rather
    // than fall back to the last-touch values, which would fabricate first-touch.
    const props = mapAttributionExtraProperties({
      utmSource: 'newsletter',
      utmMedium: 'email',
      from: 'plus-modal',
    });
    expect(props.initial_utm_source).toBeUndefined();
    expect(props.initial_utm_medium).toBeUndefined();
    expect(props.initial_utm_campaign).toBeUndefined();
    expect(props.utm_source).toBe('newsletter');
  });
});
