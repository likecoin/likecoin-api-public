import { Router } from 'express';
import { BigNumber } from 'bignumber.js';
import { getCosmosTotalSupply, getCosmosAccountLIKE } from '../../util/cosmos';
import { IS_TESTNET } from '../../constant';

const router = Router();

/* wallets used for migration/burn/vault/etc */
const reservedWallets = IS_TESTNET ? [
  'cosmos1ca0zlqxjqv5gek5qxm602umtkmu88564hpyws4',
] : [
  'cosmos1xxr3yfvr0zc6dqdy7jttjh6nvupx9j08d3v538', // ecosystem development pool 1
  'cosmos1rr8km790vqdgl6h97hz7ghlatad87jnyrh2qka', // ecosystem development pool 2
  'cosmos1sltfqp94nmmzkgvwrfqwl5f34u0rfdxq2e5a6c', // team pool
];

router.get('/totalsupply', async (req, res) => {
  const ONE_DAY_IN_S = 3600;
  const rawSupply = await getCosmosTotalSupply();
  const amounts = await Promise.all(reservedWallets
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
