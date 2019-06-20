import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { filterWalletInfo } from '../../util/ValidationHelper';

const router = Router();

router.get('/list', jwtAuth('read'), async (req, res, next) => {
  try {
    const id = req.user.user;
    const [walletsCol, userDoc] = await Promise.all([
      dbRef.doc(id).collection('wallets').get(),
      dbRef.doc(id).get(),
    ]);
    const { wallet } = userDoc.data();
    const wallets = walletsCol.docs.map(doc => filterWalletInfo(doc.data()));
    if (wallet) wallets.push(filterWalletInfo({ address: wallet, type: 'main' }));
    res.json({ wallets });
  } catch (err) {
    next(err);
  }
});

router.post('/select', jwtAuth('write'), async (req, res, next) => {
  try {
    const { wallet } = req.body;
    const id = req.user.user;
    const [walletQuery, userDoc] = await Promise.all([
      dbRef.doc(id).collection('wallets').where('address', '==', wallet).limit(1)
        .get(),
      dbRef.doc(id).get(),
    ]);
    const { wallet: userMainWallet } = userDoc.data();

    let type = 'main';
    if (wallet !== userMainWallet) {
      if (walletQuery.empty) {
        res.status(404).send('WALLET_NOT_FOUND');
        return;
      }
      ({
        type,
      } = walletQuery.docs[0].data());
    }

    await dbRef.doc(id).update({ currentWallet: wallet });
    res.json({ wallet, type });
  } catch (err) {
    next(err);
  }
});

router.post('/new', jwtAuth('write'), async (req, res, next) => {
  try {
    const {
      wallet,
    } = req.body;
    const { user } = req.user;

    // determine id of new wallet
    const col = await dbRef.doc(user).collection('wallets').get();
    const walletIds = [];
    col.docs.forEach(({ id }) => {
      const result = /wallet(\d+)/.exec(id);
      if (result) walletIds.push(parseInt(result[1], 10));
    });
    const currentMaxId = Math.max(...walletIds);
    const newId = `wallet${currentMaxId < 0 ? 1 : currentMaxId + 1}`;
    const type = 'web3';
    await dbRef.doc(user).collection('wallets').doc(newId).create({
      type,
      address: wallet,
      ts: Date.now(),
    });
    res.json({ type, wallet });
  } catch (err) {
    next(err);
  }
});

export default router;
