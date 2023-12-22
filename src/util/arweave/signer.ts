import { TypedEthereumSigner } from 'arbundles';

import { BUNDLR_MATIC_WALLET_PRIVATE_KEY } from '../../../config/secret';
import { IS_TESTNET } from '../../constant';

// eslint-disable-next-line no-underscore-dangle
let _maticBundlr;

export async function getMaticBundlr() {
  if (!_maticBundlr) {
    // eslint-disable-next-line global-require
    if (!global.crypto) global.crypto = require('crypto'); // hack for bundlr
    const { NodeBundlr } = await (import('@bundlr-network/client'));
    _maticBundlr = new NodeBundlr(
      IS_TESTNET ? 'http://node2.bundlr.network' : 'http://node1.bundlr.network',
      'matic',
      BUNDLR_MATIC_WALLET_PRIVATE_KEY,
    );
  }
  return _maticBundlr;
}

let signer: TypedEthereumSigner | null = null;
export async function initWallet(): Promise<TypedEthereumSigner> {
  if (!BUNDLR_MATIC_WALLET_PRIVATE_KEY) throw new Error('Private key is undefined!');
  const s = new TypedEthereumSigner(BUNDLR_MATIC_WALLET_PRIVATE_KEY);
  return s;
}

export async function getPublicKey() {
  if (!signer) signer = await initWallet();
  return signer.publicKey;
}

export async function signData(signatureData) {
  if (!signer) signer = await initWallet();
  return Buffer.from(await signer.sign(signatureData));
}
