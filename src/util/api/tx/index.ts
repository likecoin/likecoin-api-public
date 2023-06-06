import BigNumber from 'bignumber.js';

import { LIKEToAmount, amountToLIKE } from '../../cosmos';

export function filterMultipleTxData(data, filter = {}) {
  const {
    to,
    toIds,
    value,
    amount,
  } = data;
  const { to: { addresses, id } = {} }: { to?: { addresses?: string[]; id?: string} } = filter;
  const result = {};
  to.forEach((addr, index) => {
    if (addresses && !addresses.includes(addr)) return;
    if (id && toIds[index] !== id) return;
    result[addr] = result[addr]
      || {
        id: toIds[index],
        value: value ? new BigNumber(0) : undefined,
        amount: amount ? new BigNumber(0) : undefined,
      };
    if (result[addr].id !== toIds[index]) {
      throw new Error(`Filter ID ${toIds[index]} found, expected: ${result[addr].id}`);
    }
    if (value) result[addr].value = result[addr].value.plus(new BigNumber(value[index]));
    if (amount) result[addr].amount = result[addr].amount.plus(amountToLIKE(amount[index]));
  });
  // Flatten the result to arrays.
  const tos = Object.keys(result);
  const ids: string[] = [];
  const values: string[] = [];
  const amounts: any[] = [];
  tos.forEach((addr) => {
    ids.push(result[addr].id);
    if (value) values.push(result[addr].value.toString());
    if (amount) amounts.push(LIKEToAmount(result[addr].amount.toFixed()));
  });
  const output = {
    ...data,
    to: tos,
    toId: ids,
    value: value ? values : undefined,
    amount: amount ? amounts : undefined,
  };
  return output;
}

export default filterMultipleTxData;
