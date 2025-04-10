import { Router } from 'express';
import { ValidationError } from '../../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../../middleware/jwt';
import { listBookCollectionsInfoByModeratorWallet } from '../../../../util/api/likernft/collection/book';
import { getNFTCollectionsByOwner, CollectionType, getLatestNFTCollection } from '../../../../util/api/likernft/collection';
import { isValidEVMAddress } from '../../../../util/evm';
import { isValidLikeAddress } from '../../../../util/cosmos';

const router = Router();

router.get('/list', jwtOptionalAuth('read:nftcollection'), async (req, res, next) => {
  try {
    const userWallet = req.user?.wallet;
    const { wallet } = req.query;
    const type = 'book';
    if (wallet) {
      if (!isValidLikeAddress(wallet) && !isValidEVMAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const list = await getNFTCollectionsByOwner(
        wallet as string,
        userWallet === wallet,
        type as CollectionType,
      );
      res.json({ list });
      return;
    }
    const list = await getLatestNFTCollection(type as CollectionType);
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.get('/list/moderated', jwtAuth('read:nftcollection'), async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet) throw new ValidationError('INVALID_WALLET');
    const list = await listBookCollectionsInfoByModeratorWallet(req.user.wallet);
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

export default router;
