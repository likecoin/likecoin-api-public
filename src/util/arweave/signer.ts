import { TypedEthereumSigner } from 'arbundles';
import Bundlr from '@bundlr-network/client';

import { BUNDLR_MATIC_WALLET_PRIVATE_KEY } from '../../../config/secret';
import { IS_TESTNET } from '../../constant';

export const maticBundlr = new Bundlr(
  IS_TESTNET ? 'http://node2.bundlr.network' : 'http://node1.bundlr.network',
  'matic',
  BUNDLR_MATIC_WALLET_PRIVATE_KEY,
);

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
