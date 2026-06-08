export const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export function isValidEVMAddress(address) {
  return EVM_ADDRESS_REGEX.test(address);
}

export default isValidEVMAddress;
