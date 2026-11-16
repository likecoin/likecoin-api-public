// An HK geoblock implies CN.
export const GEOBLOCK_HK_TERRITORIES = ['HK', 'CN'];

// Expects valid uppercase ISO codes; dedupes after expanding HK.
export function expandRestrictedTerritories(codes: string[]): string[] {
  return [...new Set(codes.flatMap((code) => (code === 'HK' ? GEOBLOCK_HK_TERRITORIES : [code])))];
}
