// Build a mock EVM-style address (0x + 40 hex chars) from a short suffix.
// Numbers render as hex; strings are taken as-is. Used as both wallet addresses and class IDs.
// Matching real on-chain shape keeps test data realistic, beyond what isEVMClassId requires.
const mockEVMAddress = (suffix: string | number): string => {
  const hex = typeof suffix === 'number' ? suffix.toString(16) : suffix;
  return `0x${hex.padStart(40, '0')}`;
};

export default mockEVMAddress;
