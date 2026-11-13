import { describe, it, expect } from 'vitest';
import { toAirtablePublishedDate, toAirtablePublishedDateUpdate } from '../../src/util/airtable';

describe('toAirtablePublishedDate', () => {
  it('keeps a plain date', () => {
    expect(toAirtablePublishedDate('2023-07-01')).toBe('2023-07-01');
  });

  it('cuts an ISO date-time down to its date', () => {
    expect(toAirtablePublishedDate('2024-03-01T00:00:00.000Z')).toBe('2024-03-01');
  });

  it('keeps a leap day in a leap year', () => {
    expect(toAirtablePublishedDate('2024-02-29')).toBe('2024-02-29');
  });

  it('drops impossible calendar dates', () => {
    expect(toAirtablePublishedDate('2023-13-01')).toBeUndefined();
    expect(toAirtablePublishedDate('2023-02-29')).toBeUndefined();
    expect(toAirtablePublishedDate('2023-04-31')).toBeUndefined();
    expect(toAirtablePublishedDate('2023-00-10')).toBeUndefined();
  });

  it('drops values Airtable cannot store as a date', () => {
    expect(toAirtablePublishedDate('2023')).toBeUndefined();
    expect(toAirtablePublishedDate('')).toBeUndefined();
    expect(toAirtablePublishedDate(20230701)).toBeUndefined();
    expect(toAirtablePublishedDate(undefined)).toBeUndefined();
  });
});

describe('toAirtablePublishedDateUpdate', () => {
  it('writes a storable date', () => {
    expect(toAirtablePublishedDateUpdate('2023-07-01T00:00:00Z')).toBe('2023-07-01');
  });

  it('clears the cell when a supplied date cannot be stored', () => {
    expect(toAirtablePublishedDateUpdate('2023')).toBeNull();
    expect(toAirtablePublishedDateUpdate('2023-02-29')).toBeNull();
  });

  it('leaves the cell alone when no date is supplied', () => {
    expect(toAirtablePublishedDateUpdate(undefined)).toBeUndefined();
    expect(toAirtablePublishedDateUpdate('')).toBeUndefined();
  });
});
