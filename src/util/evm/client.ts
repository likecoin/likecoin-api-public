import {
  Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  HttpTransport,
  LocalAccount,
  PublicClient,
  WalletClient,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { IS_TESTNET } from '../../constant';
import {
  LIKER_NFT_PRIVATE_KEY,
} from '../../../config/secret';
import config from '../../../config/config';

let client: PublicClient<HttpTransport, Chain, undefined>;
let walletClient: WalletClient<HttpTransport, Chain, LocalAccount>;

const baseWithFee = defineChain({
  ...base,
  fees: {
    baseFeeMultiplier: 2,
  },
});

const baseSepoliaWithFee = defineChain({
  ...baseSepolia,
  fees: {
    baseFeeMultiplier: 2,
  },
});

export function getEVMClient(): PublicClient<HttpTransport, Chain, undefined> {
  if (!client) {
    const rpcUrl = config.EVM_RPC_ENDPOINT_OVERRIDE || undefined;
    client = createPublicClient({
      chain: IS_TESTNET ? baseSepoliaWithFee : baseWithFee,
      transport: http(rpcUrl),
    }) as PublicClient<HttpTransport, Chain, undefined>;
  }
  return client;
}

export function getEVMWalletAccount(): LocalAccount {
  const evmHex = LIKER_NFT_PRIVATE_KEY.toString('hex');
  const account = privateKeyToAccount(`0x${evmHex}`);
  return account;
}

export function getEVMWalletClient(): WalletClient<HttpTransport, Chain, LocalAccount> {
  if (!walletClient) {
    const account = getEVMWalletAccount();
    const rpcUrl = config.EVM_RPC_ENDPOINT_OVERRIDE || undefined;
    walletClient = createWalletClient({
      account,
      chain: IS_TESTNET ? baseSepoliaWithFee : baseWithFee,
      transport: http(rpcUrl),
    });
  }
  return walletClient;
}

export default getEVMClient;
