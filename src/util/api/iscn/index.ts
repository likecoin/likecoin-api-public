import BigNumber from 'bignumber.js';
import { ISCNSigningClient, ISCNSignPayload, ISCNRecordData } from '@likecoin/iscn-js';
import { formatMsgCreateIscnRecord, formatMsgChangeIscnRecordOwnership } from '@likecoin/iscn-js/dist/messages/iscn';
import { getISCNIdPrefix } from '@likecoin/iscn-js/dist/iscn/iscnId';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { DEFAULT_CHANGE_ISCN_OWNERSHIP_GAS, DEFAULT_GAS_PRICE, sendTransactionWithSequence } from '../../cosmos/tx';
import { COSMOS_CHAIN_ID } from '../../cosmos';

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

export async function processCreateAndTransferISCN(
  ISCNPayload: ISCNSignPayload,
  wallet: string | null,
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

  const iscnId = `iscn://likecoin-chain/${getISCNIdPrefix(address, ISCNPayload)}/1`;

  const messages = [
    formatMsgCreateIscnRecord(address, ISCNPayload),
  ];
  if (wallet) {
    messages.push(formatMsgChangeIscnRecordOwnership(address, iscnId, wallet));
  }

  const signingFunction = async ({ sequence }) => {
    const r = await signingClient.sendMessages(
      address,
      messages,
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
    sendTransactionWithSequence(address, signingFunction),
  ]);
  const {
    transactionHash,
    gasWanted = 0,
    gasUsed = 0,
  } = iscnRes;

  const iscnLIKE = new BigNumber(iscnGasFee.iscnFee.amount).shiftedBy(-9);
  const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
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
