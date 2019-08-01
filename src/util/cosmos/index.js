import axios from 'axios';
import {
  COSMOS_LCD_ENDPOINT as cosmosLCDEndpoint,
  COSMOS_DENOM,
} from '../../../config/config';

const api = axios.create({ baseURL: `http://${cosmosLCDEndpoint}` });

function LIKEToNanolike(value) {
  return `${Number.parseInt(value, 10).toString()}000000000`;
}

export function LIKEToAmount(value) {
  return { denom: COSMOS_DENOM, amount: LIKEToNanolike(value) };
}
export function amountToLIKE(likecoin) {
  if (likecoin.denom === 'nanolike') {
    return (Number.parseFloat(likecoin.amount) / 1e9);
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

export async function getCosmosAccountLIKE(address) {
  const { data } = await api.get(`/auth/accounts/${address}`);
  const likecoin = data.coins.find(c => c.denom === COSMOS_DENOM);
  return likecoin ? amountToLIKE(likecoin) : 0;
}

export const COSMOS_LCD_ENDPOINT = cosmosLCDEndpoint;
