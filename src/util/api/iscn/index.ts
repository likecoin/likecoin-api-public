import BigNumber from 'bignumber.js';
import { ISCNSigningClient, ISCNSignPayload } from '@likecoin/iscn-js';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { DEFAULT_CHANGE_ISCN_OWNERSHIP_GAS, DEFAULT_GAS_PRICE, sendTransactionWithSequence } from '../../cosmos/tx';
import { COSMOS_CHAIN_ID } from '../../cosmos';
import { sleep } from '../../misc';

export async function estimateCreateISCN(
  ISCNPayload: ISCNSignPayload,
  signingClient: ISCNSigningClient,
) {
  const iscnGasAndFee = await signingClient.esimateISCNTxGasAndFee(ISCNPayload);
  const changeISCNOwnershipFee = new BigNumber(DEFAULT_CHANGE_ISCN_OWNERSHIP_GAS)
    .multipliedBy(DEFAULT_GAS_PRICE);
  const newISCNPrice = new BigNumber(iscnGasAndFee.gas.fee.amount[0].amount)
    .plus(iscnGasAndFee.iscnFee.amount)
    .plus(changeISCNOwnershipFee).shiftedBy(-9)
    .toNumber();
  return newISCNPrice;
}

export async function processCreateISCN(
  ISCNPayload: ISCNSignPayload,
  signingClient: ISCNSigningClient,
  signingInfo: {
    address: string,
    accountNumber: number,
  },
) {
  const {
    address,
    accountNumber,
  } = signingInfo;

  const queryClient = await signingClient.getISCNQueryClient();

  const createIscnSigningFunction = async ({ sequence }): Promise<TxRaw> => {
    const r = await signingClient.createISCNRecord(
      address,
      ISCNPayload,
      {
        accountNumber,
        sequence,
        chainId: COSMOS_CHAIN_ID,
        broadcast: false,
      },
    );
    return r as TxRaw;
  };

  const [iscnGasFee, iscnRes] = await Promise.all([
    signingClient.esimateISCNTxGasAndFee(ISCNPayload),
    sendTransactionWithSequence(address, createIscnSigningFunction),
  ]);
  const iscnLIKE = new BigNumber(iscnGasFee.iscnFee.amount).shiftedBy(-9);
  const {
    transactionHash,
    gasWanted = 0,
    gasUsed = 0,
  } = iscnRes;
  const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
  let iscnId;
  const QUERY_RETRY_LIMIT = 10;
  let tryCount = 0;
  while (!iscnId && tryCount < QUERY_RETRY_LIMIT) {
    /* eslint-disable no-await-in-loop */
    ([iscnId] = await queryClient.queryISCNIdsByTx(transactionHash));
    if (!iscnId) await sleep(2000);
    tryCount += 1;
    /* eslint-enable no-await-in-loop */
  }
  const totalLIKE = gasLIKE.plus(iscnLIKE);
  return {
    iscnId,
    transactionHash,
    iscnLIKE,
    totalLIKE,
    gasLIKE,
    gasWanted,
    gasUsed,
  };
}

export async function processTransferISCN(
  iscnId,
  targetWallet,
  signingClient: ISCNSigningClient,
  signingInfo: {
      address: string,
      accountNumber: number,
    },
) {
  const {
    address,
    accountNumber,
  } = signingInfo;
  const wallet = targetWallet;
  const transferSigningFunction = async ({ sequence }: { sequence: number }) => {
    const r = await signingClient.changeISCNOwnership(
      address,
      wallet,
      iscnId,
      {
        accountNumber,
        sequence,
        chainId: COSMOS_CHAIN_ID,
        broadcast: false,
      },
    );
    return r as TxRaw;
  };
  const iscnTransferRes = await sendTransactionWithSequence(
    address,
    transferSigningFunction,
  );
  const {
    transactionHash,
    gasUsed,
    gasWanted,
  } = iscnTransferRes;
  const gasLIKE = new BigNumber(gasUsed)
    .multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
  return {
    transactionHash,
    gasUsed,
    gasWanted,
    gasLIKE,
  };
}
