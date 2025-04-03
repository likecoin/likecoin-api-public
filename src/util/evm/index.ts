export function isValidEvmAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export default isValidEvmAddress;
