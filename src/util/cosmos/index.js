
import BigNumber from 'bignumber.js';
import {
  COSMOS_LCD_ENDPOINT as cosmosLCDEndpoint,
  ISCN_DEV_LCD_ENDPOINT as iscnDevLCDEndpoint,
  COSMOS_DENOM,
} from '../../../config/config';
import { createAPIEndpoint } from './api';

const api = createAPIEndpoint(cosmosLCDEndpoint);

function LIKEToNanolike(value) {
  return (new BigNumber(value)).multipliedBy(1e9).toFixed();
}

export function LIKEToAmount(value) {
  return { denom: COSMOS_DENOM, amount: LIKEToNanolike(value) };
}
export function amountToLIKE(likecoin) {
  if (likecoin.denom === 'nanolike') {
    return (new BigNumber(likecoin.amount)).dividedBy(1e9).toFixed();
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

export async function getCosmosTotalSupply() {
  const { data } = await api.get(`/supply/total/${COSMOS_DENOM}`);
  return (new BigNumber(data.result)).dividedBy(1e9).toFixed();
}

export async function getCosmosAccountLIKE(address) {
  const { data } = await api.get(`/auth/accounts/${address}`);
  if (!data.result.value || !data.result.value.coins || !data.result.value.coins.length) return 0;
  const likecoin = data.result.value.coins.find(c => c.denom === COSMOS_DENOM);
  return likecoin ? amountToLIKE(likecoin) : 0;
}

export const COSMOS_LCD_ENDPOINT = cosmosLCDEndpoint;

export const ISCN_LCD_ENDPOINT = iscnDevLCDEndpoint;
