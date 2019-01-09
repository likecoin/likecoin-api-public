import { Router } from 'express';
import { BigNumber } from 'bignumber.js';
import { LikeCoin } from '../../util/web3';

const router = Router();

router.get('/totalsupply', async (req, res) => {
  const ONE_DAY_IN_S = 86400;
  const rawSupply = await LikeCoin.methods.totalSupply().call();
  const apiValue = new BigNumber(rawSupply).div(new BigNumber(10).pow(18)).toFixed();
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, s-maxage=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
  res.send(apiValue);
});

export default router;
