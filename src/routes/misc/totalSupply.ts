import { Router } from 'express';
import { BigNumber } from 'bignumber.js';
import { mainnet, sepolia } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import { readContract } from 'viem/actions';
import {
  IS_TESTNET, ONE_DAY_IN_S, ONE_HOUR_IN_S,
} from '../../constant';
import { LIKE_COIN_ABI, LIKE_COIN_ADDRESS } from '../../constant/contract/likecoin';
import { getCosmosTotalSupply, getCosmosAccountLIKE } from '../../util/cosmos';

const router = Router();

const publicClient = createPublicClient({
  chain: IS_TESTNET ? sepolia : mainnet,
  transport: http(),
});

const reservedEthWallets = IS_TESTNET ? [
] : [
  '0xe790610b59414dd50aeeeaac0b7784644ac5588c', // ecosystem development pool
  '0x48bbaaf8fc448e641895e5ec6909dfd805ec3a85', // unknown 1
  '0x29e25a283124b2a549bd01265dcb525fd5bb9bb5', // unknown 2
];

/* wallets used for migration/burn/vault/etc */
const reservedCosmosWallets = IS_TESTNET ? [
  'cosmos1ca0zlqxjqv5gek5qxm602umtkmu88564hpyws4',
] : [
  'cosmos1sltfqp94nmmzkgvwrfqwl5f34u0rfdxq2e5a6c', // team pool
  'cosmos1rr8km790vqdgl6h97hz7ghlatad87jnyrh2qka', // ecosystem development pool 2
];

router.get('/totalsupply/erc20', async (req, res, next) => {
  try {
    let rawSupply = new BigNumber(await readContract(publicClient, {
      address: LIKE_COIN_ADDRESS,
      abi: LIKE_COIN_ABI,
      functionName: 'totalSupply',
    }) as number);
    if (req.query.raw !== '1') {
      rawSupply = rawSupply.div(new BigNumber(10).pow(18));
    }
    const apiValue = rawSupply.toFixed();
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    res.send(apiValue);
  } catch (err) {
    next(err);
  }
});

router.get('/circulating/erc20', async (req, res, next) => {
  try {
    const rawSupply = await readContract(publicClient, {
      address: LIKE_COIN_ADDRESS,
      abi: LIKE_COIN_ABI,
      functionName: 'totalSupply',
    }) as number;
    const amounts = await Promise.all(reservedEthWallets
      .map((w) => readContract(publicClient, {
        address: LIKE_COIN_ADDRESS,
        abi: LIKE_COIN_ABI,
        functionName: 'balanceOf',
        args: [w],
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        return 0;
      }))) as number[];
    let actualValue = amounts.reduce((acc, a) => acc.minus(a), new BigNumber(rawSupply));
    if (req.query.raw !== '1') {
      actualValue = actualValue.div(new BigNumber(10).pow(18));
    }
    const apiValue = actualValue.toFixed();
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    res.send(apiValue);
  } catch (err) {
    next(err);
  }
});

router.get(['/totalsupply', '/totalsupply/likecoinchain'], async (req, res, next) => {
  try {
    let rawSupply = new BigNumber(await getCosmosTotalSupply());
    if (req.query.raw === '1') {
      rawSupply = rawSupply.times(new BigNumber(10).pow(9));
    }
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    res.send(rawSupply.toFixed());
  } catch (err) {
    next(err);
  }
});

router.get(['/circulating', '/circulating/likecoinchain'], async (req, res, next) => {
  try {
    const rawSupply = await getCosmosTotalSupply();
    const amounts = await Promise.all(reservedCosmosWallets
      .map((w) => getCosmosAccountLIKE(w).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        return 0;
      })));
    let apiValue = amounts.reduce((acc, a) => acc.minus(a), new BigNumber(rawSupply));
    if (req.query.raw === '1') {
      apiValue = apiValue.times(new BigNumber(10).pow(9));
    }
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    res.send(apiValue.toFixed());
  } catch (err) {
    next(err);
  }
});

export default router;
