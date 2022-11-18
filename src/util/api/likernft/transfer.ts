import axios from 'axios';

import { db, likeNFTCollection } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from '.';

import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

export async function getNFTTransferInfo(txHash, classId, nftId) {
  const { data } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/tx/v1beta1/txs/${txHash}`);
  if (!data) return null;
  const message = data.tx.body.messages.find((m) => m['@type'] === '/cosmos.nft.v1beta1.MsgSend'
      && m.id === nftId && m.class_id === classId);
  if (!message) return null;
  const {
    sender: fromAddress,
    receiver: toAddress,
  } = message;
  const { timestamp } = data.tx_response;
  return {
    fromAddress,
    toAddress,
    txTimestamp: Date.parse(timestamp),
  };
}

export async function processNFTTransfer({
  fromAddress,
  toAddress,
  iscnPrefix,
  classId,
  nftId,
  txHash,
  txTimestamp,
}) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const iscnRef = likeNFTCollection.doc(iscnPrefixDocName);
  const classRef = iscnRef.collection('class').doc(classId);
  const nftRef = classRef.collection('nft').doc(nftId);
  await db.runTransaction(async (t) => {
    const nftDoc = await t.get(nftRef);
    if (!nftDoc.exists) throw new ValidationError('NFT_NOT_FOUND');
    const { lastUpdateTimestamp: dbTimestamp = 0 } = nftDoc.data();
    if (txTimestamp <= dbTimestamp) throw new ValidationError('OUTDATED_TRANSFER_DATA');
    t.update(nftRef, {
      ownerWallet: toAddress,
      lastUpdateTimestamp: txTimestamp,
    });
    t.create(iscnRef.collection('transaction')
      .doc(txHash), {
      event: 'transfer',
      txHash,
      classId,
      nftId,
      timestamp: txTimestamp,
      fromWallet: fromAddress,
      toWallet: toAddress,
    });
  });
}
