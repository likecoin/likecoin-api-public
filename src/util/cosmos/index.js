import axios from 'axios';
import {
  COSMOS_LCD_ENDPOINT,
  COSMOS_DENOM,
} from '../../../config/config';

const api = axios.create({ baseURL: `http://${COSMOS_LCD_ENDPOINT}` });

function likeToNanolike(value) {
  return `${Number.parseInt(value, 10).toString()}000000000`;
}

export function likeToAmount(value) {
  return { denom: COSMOS_DENOM, amount: likeToNanolike(value) };
}

function amountToLike(likecoin) {
  return (Number.parseFloat(likecoin.amount) / 1e9);
}

export async function getCosmosAccountInfo(address) {
  const { data } = await api.get(`/auth/accounts/${address}`);
  const likecoin = data.coins.find(c => c.denom === COSMOS_DENOM);
  return likecoin ? amountToLike(likecoin) : 0;
}
