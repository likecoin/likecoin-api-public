import {
  describe, it, expect,
} from 'vitest';
import { getIpCountryFromRequest, parseCountryCode } from '../../src/util/misc';

describe('getIpCountryFromRequest', () => {
  it('prefers the Cloudflare header and uppercases it', () => {
    expect(getIpCountryFromRequest({ headers: { 'cf-ipcountry': 'hk' }, body: {} } as any)).toBe('HK');
  });

  it('falls back to the body for a relayed request', () => {
    expect(getIpCountryFromRequest({ headers: {}, body: { ipCountry: 'tw' } } as any)).toBe('TW');
  });

  it('lets the header win over the body', () => {
    expect(getIpCountryFromRequest({
      headers: { 'cf-ipcountry': 'US' },
      body: { ipCountry: 'HK' },
    } as any)).toBe('US');
  });

  it('returns undefined rather than an empty string when unknown', () => {
    expect(getIpCountryFromRequest({ headers: {}, body: {} } as any)).toBeUndefined();
    expect(getIpCountryFromRequest({ headers: { 'cf-ipcountry': '' }, body: {} } as any)).toBeUndefined();
    expect(getIpCountryFromRequest({ headers: {} } as any)).toBeUndefined();
  });

  it('ignores a duplicated header rather than throwing', () => {
    expect(getIpCountryFromRequest({ headers: { 'cf-ipcountry': ['HK', 'US'] }, body: {} } as any)).toBeUndefined();
  });
});

describe('parseCountryCode', () => {
  it('uppercases a recognised country code', () => {
    expect(parseCountryCode('tw')).toBe('TW');
    expect(parseCountryCode('HK')).toBe('HK');
    expect(parseCountryCode(' gb ')).toBe('GB');
  });

  it('drops the placeholders Cloudflare sends for unresolvable IPs', () => {
    expect(parseCountryCode('XX')).toBeUndefined();
    expect(parseCountryCode('T1')).toBeUndefined();
  });

  it('drops anything not on the allowlist rather than trusting the caller', () => {
    expect(parseCountryCode('ZZ')).toBeUndefined();
    expect(parseCountryCode('TAIWAN')).toBeUndefined();
    expect(parseCountryCode('../../etc')).toBeUndefined();
  });

  it('returns undefined for a missing or empty country', () => {
    expect(parseCountryCode()).toBeUndefined();
    expect(parseCountryCode('')).toBeUndefined();
    expect(parseCountryCode('   ')).toBeUndefined();
  });
});
