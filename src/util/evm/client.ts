import {
  Chain,
  createPublicClient,
  http,
  HttpTransport,
  PublicClient,
} from 'viem';

import { optimism, optimismSepolia } from 'viem/chains';
import { IS_TESTNET } from '../../constant';

let client: PublicClient<HttpTransport, Chain, undefined>;
export function getEVMClient(): PublicClient<HttpTransport, Chain, undefined> {
  if (!client) {
    client = createPublicClient({
      chain: IS_TESTNET ? optimismSepolia : optimism,
      transport: http(),
    }) as PublicClient<HttpTransport, Chain, undefined>;
  }
  return client;
}

export default getEVMClient;
