import {
  Chain,
  createPublicClient,
  createWalletClient,
  http,
  HttpTransport,
  LocalAccount,
  PublicClient,
  WalletClient,
} from 'viem';
import { optimism, optimismSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { IS_TESTNET } from '../../constant';
import {
  LIKER_NFT_PRIVATE_KEY,
} from '../../../config/secret';

let client: PublicClient<HttpTransport, Chain, undefined>;
let walletClient: WalletClient<HttpTransport, Chain, LocalAccount>;

export function getEvmClient(): PublicClient<HttpTransport, Chain, undefined> {
  if (!client) {
    client = createPublicClient({
      chain: IS_TESTNET ? optimismSepolia : optimism,
      transport: http(),
    }) as PublicClient<HttpTransport, Chain, undefined>;
  }
  return client;
}

export function getEvmWalletAccount(): LocalAccount {
  const evmHex = LIKER_NFT_PRIVATE_KEY.toString('hex');
  const account = privateKeyToAccount(`0x${evmHex}`);
  return account;
}

export function getEvmWalletClient(): WalletClient<HttpTransport, Chain, LocalAccount> {
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
