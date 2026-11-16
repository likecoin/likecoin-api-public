import { ValidationError } from '../../../ValidationError';
import type { NFTBookListingInfo } from '../../../../types/book';

// An HK geoblock implies CN.
export const GEOBLOCK_HK_TERRITORIES = ['HK', 'CN'];

// Expects valid uppercase ISO codes; dedupes after expanding HK.
export function expandRestrictedTerritories(codes: string[]): string[] {
  return [...new Set(codes.flatMap((code) => (code === 'HK' ? GEOBLOCK_HK_TERRITORIES : [code])))];
}

export const RESTRICTED_TERRITORIES_SOURCES = ['review', 'admin', 'publisher'] as const;
export type RestrictedTerritoriesSource = typeof RESTRICTED_TERRITORIES_SOURCES[number];

// Returns what a publisher update may write, or undefined to leave the stored list as is.
// A review or admin geoblock is locked; one without a source predates publisher edits.
export function getPublisherRestrictedTerritoriesUpdate(
  {
    restrictedTerritories: current = [],
    restrictedTerritoriesSetBy,
  }: Pick<NFTBookListingInfo, 'restrictedTerritories' | 'restrictedTerritoriesSetBy'>,
  requested?: string[],
): string[] | undefined {
  if (requested === undefined) return undefined;
  if (!current.length || restrictedTerritoriesSetBy === 'publisher') return requested;
  // Clients may echo the whole settings form back, so an unchanged list is not an edit.
  const currentSet = new Set(current);
  if (requested.length === currentSet.size && requested.every((c) => currentSet.has(c))) {
    return undefined;
  }
  throw new ValidationError('RESTRICTED_TERRITORIES_LOCKED', 403);
}
