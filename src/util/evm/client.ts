import { createPublicClient, createWalletClient, http } from 'viem';
import { optimism, optimismSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { IS_TESTNET } from '../../constant';
import {
  LIKER_NFT_PRIVATE_KEY,
} from '../../../config/secret';

let client;
let walletClient;
export function getEvmClient() {
  if (!client) {
    client = createPublicClient({
      chain: IS_TESTNET ? optimismSepolia : optimism,
      transport: http(),
    });
  }
  return client;
}

export function getEvmWalletAccount() {
  const evmHex = LIKER_NFT_PRIVATE_KEY.toString('hex');
  const account = privateKeyToAccount(`0x${evmHex}`);
  return account;
}

export function getEvmWalletClient() {
  if (!walletClient) {
    const account = getEvmWalletAccount();
    walletClient = createWalletClient({
      account,
      chain: IS_TESTNET ? optimismSepolia : optimism,
      transport: http(),
    });
  }
  return walletClient;
}

export default getEvmClient;
