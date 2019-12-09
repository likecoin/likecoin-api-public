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

const deductReserved = (getBalance, reservedAddresses) => async (rawSupply) => {
  const amounts = await Promise.all(reservedAddresses
    .map(w => getBalance(w).catch((err) => {
      console.error(err);
      return 0;
    })));
  return amounts.reduce((acc, a) => acc.minus(a), new BigNumber(rawSupply));
};

const getErc20Balance = address => LikeCoin.methods.balanceOf(address).call();
const deductReservedErc20 = deductReserved(getErc20Balance, reservedEthWallets);
const deductReservedCosmos = deductReserved(getCosmosAccountLIKE, reservedCosmosWallets);

const erc20RawSupplyByReq = async (value, req) => {
  const apiValue = req.query.raw !== undefined ? value : value.div(new BigNumber(10).pow(18));
  return apiValue.toFixed();
};

const cosmosRawSupplyByReq = async (value, req) => {
  const apiValue = req.query.raw !== undefined ? value.times(new BigNumber(10).pow(9)) : value;
  return apiValue.toFixed();
};

function supplyApi(rawSupplyFunc, ...processFunc) {
  return async (req, res) => {
    const ONE_HOUR_IN_S = 3600;
    const rawSupply = await rawSupplyFunc();
    const apiValue = await processFunc.reduce(
      (promise, f) => promise.then(value => f(value, req)),
      Promise.resolve(new BigNumber(rawSupply)),
    );
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-if-error=${ONE_HOUR_IN_S}`);
    res.send(apiValue);
  };
}

const getErc20RawSupply = () => LikeCoin.methods.totalSupply().call();

router.get('/totalsupply/erc20', supplyApi(getErc20RawSupply, erc20RawSupplyByReq));
router.get('/circulating/erc20', supplyApi(getErc20RawSupply, deductReservedErc20, erc20RawSupplyByReq));
router.get(['/totalsupply', '/totalsupply/likecoinchain'], supplyApi(getCosmosTotalSupply, cosmosRawSupplyByReq));
router.get(['/circulating', '/circulating/likecoinchain'], supplyApi(getCosmosTotalSupply, deductReservedCosmos, cosmosRawSupplyByReq));

export default router;
