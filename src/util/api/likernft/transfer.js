import axios from 'axios';

import { db, likeNFTCollection } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from '.';

import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

export async function getNFTTransferInfo(txHash, nftId) {
  const { data } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/tx/v1beta1/txs/${txHash}`);
  if (!data) return null;
  const message = data.tx.body.messages.find(m => m['@type'] === '/cosmos.nft.v1beta1.MsgSend' && m.id === nftId);
  if (!message) return null;
  const {
    class_id: classId,
    sender: fromAddress,
    receiver: toAddress,
  } = message;
  const { timestamp: txTimestamp } = data.tx_response;
  return {
    fromAddress,
    toAddress,
    classId,
    txTimestamp,
  };
}

export async function processNFTTransfer({
  newOwnerAddress,
  iscnId,
  classId,
  nftId,
  txTimestamp,
}) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const iscnRef = likeNFTCollection.doc(iscnPrefix);
  const classRef = iscnRef.collection('class').doc(classId);
  const nftRef = classRef.collection('nft').doc(nftId);
  await db.runTransaction(async (t) => {
    const nftDoc = await t.get(nftRef);
    if (!nftDoc.exists) throw new ValidationError('NFT_NOT_FOUND');
    const { lastUpdateTimestamp: dbTimestamp = 0 } = nftDoc.data();
    if (txTimestamp <= dbTimestamp) throw new ValidationError('OUTDATED_TRANSFER_DATA');
    t.update(nftRef, {
      ownerWallet: newOwnerAddress,
      lastUpdateTimestamp: txTimestamp,
    });
  });
}
