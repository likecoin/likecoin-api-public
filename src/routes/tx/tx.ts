import { Router } from 'express';
import { txCollection as txLogRef, userCollection } from '../../util/firebase';
import { filterMultipleTxData } from '../../util/api/tx';
import { filterTxData } from '../../util/ValidationHelper';
import { jwtOptionalAuth } from '../../middleware/jwt';
import {
  TX_METADATA_TYPES,
  TX_METADATA_TIME,
  TX_METADATA_FIELDS,
} from '../../constant/tx';
import { RPC_TX_UPDATE_COOKIE_KEY } from '../../constant';

const router = Router();

router.get('/id/:id', async (req, res, next) => {
  try {
    const { id: txHash } = req.params;
    const { address } = req.query;
    const doc = await txLogRef.doc(txHash).get();
    if (doc.exists) {
      const payload = doc.data().toIds
        ? filterMultipleTxData(doc.data(), { to: { addresses: address ? [address] : null } })
        : doc.data();
      res.json(filterTxData(payload));
      return;
    }
    res.sendStatus(404);
  } catch (err) {
    next(err);
  }
});

router.post('/id/:id/metadata', jwtOptionalAuth('write'), async (req, res, next) => {
  try {
    const { id: txHash } = req.params;
    const { user } = (req.user || {});
    const { metadata } = req.body;
    const updateToken = req.cookies[RPC_TX_UPDATE_COOKIE_KEY];
    if (!user && !updateToken) {
      res.status(401).send('MISSING_TOKEN');
      return;
    }

    const promises = [txLogRef.doc(txHash).get()];
    if (user) promises.push(userCollection.doc(user).get());
    const [txDoc, userDoc] = await Promise.all(promises);

    if (!txDoc.exists) {
      res.sendStatus(404);
      return;
    }
    const txData = txDoc.data();
    const {
      fromId,
      from,
      ts,
      metadata: docMetadata,
      updateToken: docUpdateToken,
    } = txData;

    if (updateToken) {
      if (updateToken !== docUpdateToken) {
        res.sendStatus(403);
        return;
      }
    } else if (user) {
      if (!userDoc || !userDoc.exists) {
        res.sendStatus(403);
        return;
      }
      const userData = userDoc.data();
      const { cosmosWallet, likeWallet } = userData;
      if (user !== fromId && from !== cosmosWallet && from !== likeWallet) {
        res.sendStatus(403);
        return;
      }
    }
    if (docMetadata) {
      res.status(419).send('CONFLICT');
      return;
    }
    if (ts < Date.now() - TX_METADATA_TIME) {
      res.status(400).send('EXPIRED');
      return;
    }
    if (!metadata || Object.keys(metadata).some(m => !TX_METADATA_TYPES.includes(m))) {
      res.status(400).send('INVALID_METADATA');
      return;
    }
    const filteredMetadata = {};
    Object.keys(metadata).forEach((m) => {
      if (TX_METADATA_FIELDS[m]) {
        filteredMetadata[m] = {};
        TX_METADATA_FIELDS[m].forEach((k) => {
          const value = metadata[m][k];
          if (value && (Array.isArray(value) || typeof value !== 'object')) {
            filteredMetadata[m][k] = metadata[m][k];
          }
        });
      }
    });
    await txLogRef.doc(txHash).update({ metadata: filteredMetadata });
    res.sendStatus(200);
    return;
  } catch (err) {
    next(err);
  }
});

export default router;
