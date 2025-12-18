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

export async function fund(requiredAmount: string, { blocking = false } = {}) {
  const ethereumIrys = await getEthereumBundlr();
  const fundAmount = ethereumIrys.utils.toAtomic(requiredAmount);

  const currentBalance = await ethereumIrys.getLoadedBalance();
  const isInsufficient = currentBalance.lt(fundAmount);

  const multipliers = [1.2, 1.5, 2.0];
  let lastError;

  const performFunding = async () => {
    // Retry with progressively higher gas multipliers if funding fails due to low gas.
    // The Irys SDK has a timing issue where getFee() and createTx() call getGasPrice()
    // at different times. When gas prices change between these calls, the gas limit
    // calculation breaks: gasLimit = (estimatedGas * oldGasPrice * multiplier) / newGasPrice,
    // which can result in gasLimit being too low (e.g., 21005 instead of 25200).
    for (const multiplier of multipliers) {
      try {
        return await ethereumIrys.fund(fundAmount, multiplier);
      } catch (error) {
        lastError = error;
        const errorMessage = (error as Error)?.message || '';
        if (errorMessage.includes('intrinsic gas too low') || errorMessage.includes('gas too low')) {
          // eslint-disable-next-line no-console
          console.warn(`Funding failed with multiplier ${multiplier}, retrying with higher gas...`);
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  };

  // If balance is insufficient or in blocking mode, await the funding
  if (isInsufficient || blocking) {
    return performFunding();
  }

  // Balance is sufficient and in async mode: fund without awaiting
  performFunding().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Async funding failed:', error);
  });
  return null;
}
