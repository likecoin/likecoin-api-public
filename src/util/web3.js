import Web3 from 'web3';
import { LIKE_COIN_ABI, LIKE_COIN_ADDRESS } from '../constant/contract/likecoin';

const web3Provider = process.env.IS_TESTNET ? 'https://rinkeby.infura.io/v3/9a6771595426445cb247e83d4ad85645' : 'https://mainnet.infura.io/v3/9a6771595426445cb247e83d4ad85645';

export const web3 = new Web3(new Web3.providers.HttpProvider(web3Provider));
export const LikeCoin = new web3.eth.Contract(LIKE_COIN_ABI, LIKE_COIN_ADDRESS);

export function checkAddressValid(addr) {
  return addr.length === 42 && addr.substr(0, 2) === '0x';
}
