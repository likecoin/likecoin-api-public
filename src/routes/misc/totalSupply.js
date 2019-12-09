import { Router } from 'express';
import { BigNumber } from 'bignumber.js';
import Web3 from 'web3';
import { INFURA_HOST, IS_TESTNET } from '../../constant';
import { LIKE_COIN_ABI, LIKE_COIN_ADDRESS } from '../../constant/contract/likecoin';
import { getCosmosTotalSupply, getCosmosAccountLIKE } from '../../util/cosmos';

const router = Router();

const web3 = new Web3(new Web3.providers.HttpProvider(INFURA_HOST));
const LikeCoin = new web3.eth.Contract(LIKE_COIN_ABI, LIKE_COIN_ADDRESS);

const reservedEthWallets = IS_TESTNET ? [
  '0xaa2f5b6AE13bA7a3d466FFce8cD390519337AaDe',
] : [
  '0xe790610b59414dd50aeeeaac0b7784644ac5588c', // ecosystem development pool
  '0x48bbaaf8fc448e641895e5ec6909dfd805ec3a85', // unknown 1
  '0x29e25a283124b2a549bd01265dcb525fd5bb9bb5', // unknown 2
];

/* wallets used for migration/burn/vault/etc */
const reservedCosmosWallets = IS_TESTNET ? [
  'cosmos1ca0zlqxjqv5gek5qxm602umtkmu88564hpyws4',
] : [
  'cosmos1xxr3yfvr0zc6dqdy7jttjh6nvupx9j08d3v538', // ecosystem development pool 1
  'cosmos1rr8km790vqdgl6h97hz7ghlatad87jnyrh2qka', // ecosystem development pool 2
  'cosmos1sltfqp94nmmzkgvwrfqwl5f34u0rfdxq2e5a6c', // team pool
];

router.get('/totalsupply/erc20', async (req, res) => {
  const ONE_DAY_IN_S = 86400;
  const rawSupply = await LikeCoin.methods.totalSupply().call();
  const apiValue = new BigNumber(rawSupply).div(new BigNumber(10).pow(18)).toFixed();
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
  res.send(apiValue);
});

router.get('/circulating/erc20', async (req, res) => {
  const ONE_DAY_IN_S = 86400;
  const rawSupply = await LikeCoin.methods.totalSupply().call();
  const amounts = await Promise.all(reservedEthWallets
    .map(w => LikeCoin.methods.balanceOf(w).call().catch((err) => {
      console.error(err);
      return 0;
    })));
  const actualValue = amounts.reduce((acc, a) => acc.minus(a), new BigNumber(rawSupply));
  const apiValue = new BigNumber(actualValue).div(new BigNumber(10).pow(18)).toFixed();
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
  res.send(apiValue);
});

router.get(['/totalsupply', '/totalsupply/likecoinchain'], async (req, res) => {
  const ONE_DAY_IN_S = 3600;
  const rawSupply = await getCosmosTotalSupply();
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
  res.send(new BigNumber(rawSupply).toFixed());
});

router.get(['/circulating', '/circulating/likecoinchain'], async (req, res) => {
  const ONE_DAY_IN_S = 3600;
  const rawSupply = await getCosmosTotalSupply();
  const amounts = await Promise.all(reservedCosmosWallets
    .map(w => getCosmosAccountLIKE(w).catch((err) => {
      console.error(err);
      return 0;
    })));
  const apiValue = amounts.reduce((acc, a) => acc.minus(a), new BigNumber(rawSupply));
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
  res.send(apiValue.toFixed());
});

export default router;
