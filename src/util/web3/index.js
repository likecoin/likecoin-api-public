const sigUtil = require('eth-sig-util');

export function personalEcRecover(data, sig) {
  return sigUtil.recoverPersonalSignature({ data, sig });
}

export default personalEcRecover;
