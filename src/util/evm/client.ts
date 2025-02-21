import { createPublicClient, http } from 'viem';
import { optimism, optimismSepolia } from 'viem/chains';
import { IS_TESTNET } from '../../constant';

let client;
export function getEvmClient() {
  if (!client) {
    client = createPublicClient({
      chain: IS_TESTNET ? optimismSepolia : optimism,
      transport: http(),
    });
  }
  return client;
}

export default getEvmClient;
