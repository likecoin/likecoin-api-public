import { describe, it, expect } from 'vitest';
import { toAirtablePublishedDate } from '../../src/util/airtable';

describe('toAirtablePublishedDate', () => {
  it('keeps a plain date', () => {
    expect(toAirtablePublishedDate('2023-07-01')).toBe('2023-07-01');
  });

  it('cuts an ISO date-time down to its date', () => {
    expect(toAirtablePublishedDate('2024-03-01T00:00:00.000Z')).toBe('2024-03-01');
  });

  it('drops values Airtable cannot store as a date', () => {
    expect(toAirtablePublishedDate('2023')).toBeUndefined();
    expect(toAirtablePublishedDate('')).toBeUndefined();
    expect(toAirtablePublishedDate(20230701)).toBeUndefined();
    expect(toAirtablePublishedDate(undefined)).toBeUndefined();
  });
});
