import BigNumber from 'bignumber.js';
import * as uuidParse from 'uuid-parse';
import * as bech32 from 'bech32';
import Long from 'long';
import base64url from 'base64url';

import { LIKEToAmount, amountToLIKE } from '../../cosmos';
import { LikePayId } from '../../../schema/pay-id';

export function filterMultipleTxData(data, filter = {}) {
  const {
    to,
    toIds,
    value,
    amount,
  } = data;
  const { to: { addresses, id } = {} } = filter;
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
  const ids = [];
  const values = [];
  const amounts = [];
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

export function decodeLikePayId(payId) {
  const buffer = base64url.toBuffer(payId);
  const {
    uuid: uuidBuffer,
    address: addressBuffer,
    amount: amountBuffer,
  } = LikePayId.decode(buffer);
  const uuid = uuidParse.unparse(uuidBuffer);
  const address = bech32.encode('cosmos', bech32.toWords(addressBuffer));
  const bigAmount = Long.fromValue(amountBuffer, true).toString(10);
  return {
    uuid,
    address,
    bigAmount,
  };
}
