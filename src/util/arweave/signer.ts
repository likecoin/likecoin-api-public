import { TypedEthereumSigner } from 'arbundles';

import { BUNDLR_MATIC_WALLET_PRIVATE_KEY } from '../../../config/secret';
import { IS_TESTNET } from '../../constant';

// eslint-disable-next-line no-underscore-dangle
let _maticIrys;

export async function getMaticBundlr() {
  if (!_maticIrys) {
    const { NodeIrys } = await (import('@irys/sdk'));
    _maticIrys = new NodeIrys({
      network: IS_TESTNET ? 'devnet' : 'mainnet',
      token: 'matic',
      key: BUNDLR_MATIC_WALLET_PRIVATE_KEY,
      config: {
        providerUrl: IS_TESTNET ? 'https://rpc-amoy.polygon.technology' : 'https://polygon-rpc.com/',
      },
    });
  }
  return _maticIrys;
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
