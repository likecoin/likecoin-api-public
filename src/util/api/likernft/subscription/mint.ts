import { ISCNSigningClient, NewNFTClassData } from '@likecoin/iscn-js';
import { parseAndCalculateStakeholderRewards } from '@likecoin/iscn-js/dist/iscn/parsing';
import BigNumber from 'bignumber.js';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import Long from 'long';
import { formatMsgMintNFT, formatMsgSend } from '@likecoin/iscn-js/dist/messages/likenft';
// eslint-disable-next-line import/no-extraneous-dependencies
import { EncodeObject } from '@cosmjs/proto-signing';
import { formatMsgChangeIscnRecordOwnership } from '@likecoin/iscn-js/dist/messages/iscn';
import { v4 as uuidv4 } from 'uuid';

import { API_HOSTNAME } from '../../../../constant';
import { COSMOS_CHAIN_ID } from '../../../cosmos';
import { DEFAULT_GAS_PRICE, sendTransactionWithSequence } from '../../../cosmos/tx';
import { sleep } from '../../../misc';
import {
  LIKER_NFT_FEE_ADDRESS,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../../config/config';

export async function createRoyaltyConfig(
  iscnData,
  iscnOwner: string,
  classId: string,
  signingClient: ISCNSigningClient,
  signingInfo: {
    address: string,
    accountNumber: number,
  },
) {
  const rateBasisPoints = 1000; // 10% as in current chain config
  const feeAmount = 25000; // 2.5%
  const userAmount = 1000000 - feeAmount; // 1000000 - fee
  const rewardMap = await parseAndCalculateStakeholderRewards(iscnData.stakeholders, iscnOwner, {
    precision: 0,
    totalAmount: userAmount,
  });
  const rewards = Array.from(rewardMap.entries());
  const stakeholders = rewards.map((r) => {
    const [
      address,
      { amount },
    ] = r;
    return {
      account: address,
      weight: parseInt(amount, 10),
    };
  });
  stakeholders.push({
    account: LIKER_NFT_FEE_ADDRESS,
    weight: feeAmount,
  });
  const {
    address,
    accountNumber,
  } = signingInfo;
  const createRoyaltySigningFunction = async ({ sequence }): Promise<TxRaw> => {
    const r = await signingClient.createRoyaltyConfig(
      address,
      classId,
      {
        rateBasisPoints,
        stakeholders,
      },
      {
        accountNumber,
        sequence,
        chainId: COSMOS_CHAIN_ID,
        broadcast: false,
      },
    );
    return r as TxRaw;
  };
  const [royaltyRes] = await Promise.all([
    sendTransactionWithSequence(address, createRoyaltySigningFunction),
  ]);
  const {
    transactionHash,
    gasWanted = 0,
    gasUsed = 0,
  } = royaltyRes;
  return {
    transactionHash,
    gasWanted,
    gasUsed,
  };
}

export async function processNewNFTClass(
  iscnId: string,
  {
    name,
    description,
    image,
    externalURL,
    message,
    isCustomImage,
  }: {
    name: string,
    description: string,
    image: string,
    externalURL: string,
    message?: string,
    isCustomImage: boolean,
  },
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

  const metadata: {[key: string]: string;} = {
    image,
    external_url: externalURL,
    message: message || '',
    nft_meta_collection_id: 'likerland_writing_nft',
    nft_meta_collection_name: 'Writing NFT',
    nft_meta_collection_descrption: 'Writing NFT by Liker Land',
  };
  if (isCustomImage) metadata.is_custom_image = 'true';
  const payload: NewNFTClassData = {
    symbol: 'WRITING',
    uri: `https://${API_HOSTNAME}/likernft/metadata?iscn_id=${encodeURIComponent(iscnId)}`,
    name,
    description,
    metadata,
  };
  const createNFTClassSigningFunction = async ({ sequence }): Promise<TxRaw> => {
    const r = await signingClient.createNFTClass(
      address,
      iscnId,
      payload,
      undefined,
      {
        accountNumber,
        sequence,
        chainId: COSMOS_CHAIN_ID,
        broadcast: false,
      },
    );
    return r as TxRaw;
  };

  const [nftGasFee, nftRes] = await Promise.all([
    signingClient.esimateNFTClassTxGasAndFee(
      payload,
      { burnable: true, maxSupply: Long.fromNumber(500) },
    ),
    sendTransactionWithSequence(address, createNFTClassSigningFunction),
  ]);
  const classLIKE = new BigNumber(nftGasFee.nftFee.amount).shiftedBy(-9);
  const {
    transactionHash,
    gasWanted = 0,
    gasUsed = 0,
  } = nftRes;
  const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
  let classId;
  const QUERY_RETRY_LIMIT = 10;
  let tryCount = 0;
  while (!classId && tryCount < QUERY_RETRY_LIMIT) {
    /* eslint-disable no-await-in-loop */
    (classId = await queryClient.queryNFTClassIdByTx(transactionHash));
    if (!classId) await sleep(2000);
    tryCount += 1;
    /* eslint-enable no-await-in-loop */
  }
  const totalLIKE = gasLIKE.plus(classLIKE);
  return {
    classId,
    transactionHash,
    classLIKE,
    totalLIKE,
    gasLIKE,
    gasWanted,
    gasUsed,
  };
}

export async function processMintNFTClass(
  iscnId,
  classId,
  {
    name,
    image,
    message,
  }: {
    name: string;
    image: string;
    message?: string;
  },
  amount: number,
  transferTargetWallet: string,
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

  const nftsIds = [...Array(amount).keys()]
    .map((_) => `writing-${uuidv4()}`);
  const nfts = nftsIds.map((id) => {
    const uri = `${API_HOSTNAME}/likernft/metadata?class_id=${encodeURIComponent(classId)}&nft_id=${encodeURIComponent(id)}`;
    return {
      id,
      uri,
      metadata: {
        name,
        image,
        message: message || '',
      },
    };
  });
  let messages: EncodeObject[] = [];
  const mintMessages = nfts.map((i) => formatMsgMintNFT(address, classId, i));
  const sendMessages = nfts.map(
    (i) => formatMsgSend(address, LIKER_NFT_TARGET_ADDRESS, classId, i.id),
  );
  messages = messages.concat(mintMessages).concat(sendMessages);
  if (transferTargetWallet) {
    const iscnMessage = formatMsgChangeIscnRecordOwnership(address, iscnId, transferTargetWallet);
    messages.concat(iscnMessage);
  }

  const createMintNFTSigningFunction = async ({ sequence }): Promise<TxRaw> => {
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

  const [mintGasFee, mintRes] = await Promise.all([
    signingClient.esimateNFTMintTxGasAndFee(nfts[0]),
    sendTransactionWithSequence(address, createMintNFTSigningFunction),
  ]);
  const mintLIKE = new BigNumber(mintGasFee.iscnFee.amount).shiftedBy(-9).multipliedBy(amount);
  const {
    transactionHash,
    gasWanted = 0,
    gasUsed = 0,
  } = mintRes;
  const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
  const totalLIKE = gasLIKE.plus(mintLIKE);
  return {
    nftsIds,
    transactionHash,
    mintLIKE,
    totalLIKE,
    gasLIKE,
    gasWanted,
    gasUsed,
  };
}
