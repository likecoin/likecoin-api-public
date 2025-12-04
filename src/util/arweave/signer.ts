import { TypedEthereumSigner } from 'arbundles';
import type { NodeIrys as NodeIrysType } from '@irys/sdk/node';

import { BUNDLR_MATIC_WALLET_PRIVATE_KEY } from '../../../config/secret';
import { EVM_RPC_ENDPOINT_OVERRIDE } from '../../../config/config';
import { IS_TESTNET } from '../../constant';

/* eslint-disable no-underscore-dangle */
let _irysLib;
let _ethereumIrys: NodeIrysType | undefined;
/* eslint-enable no-underscore-dangle */

export async function getIrysLib() {
  if (!_irysLib) {
    _irysLib = await (import('@irys/sdk'));
  }
  return _irysLib;
}

export async function getEthereumBundlr(): Promise<NodeIrysType> {
  if (!_ethereumIrys) {
    const { NodeIrys } = await getIrysLib();
    _ethereumIrys = new NodeIrys({
      network: IS_TESTNET ? 'devnet' : 'mainnet',
      token: 'base-eth',
      key: BUNDLR_MATIC_WALLET_PRIVATE_KEY,
      config: {
        providerUrl: EVM_RPC_ENDPOINT_OVERRIDE || (IS_TESTNET ? 'https://sepolia.base.org' : 'https://mainnet.base.org'),
      },
    }) as NodeIrysType;
  }
  return _ethereumIrys;
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

export async function fund(requiredAmount: string) {
  const ethereumIrys = await getEthereumBundlr();
  const fundAmount = ethereumIrys.utils.toAtomic(requiredAmount);
  return ethereumIrys.fund(fundAmount, 1.2);
}
