import { Router } from 'express';
import { checkCosmosSignPayload, checkEvmSignPayload, getUserWithCivicLikerPropertiesByWallet } from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import {
  findLikeWalletByEvmWallet,
  checkBookUserEvmWallet,
  migrateBookClassId,
  migrateLikeUserToEvmUser,
  migrateLikeWalletToEvmWallet,
} from '../../util/api/wallet';
import { checkAddressValid, checkCosmosAddressValid } from '../../util/ValidationHelper';

const router = Router();

router.post('/authorize', async (req, res, next) => {
  try {
    const {
      wallet, from, signature, publicKey, message, signMethod,
    } = req.body;
    let { expiresIn } = req.body;
    if (!expiresIn || !['1h', '1d', '7d', '30d'].includes(expiresIn)) {
      expiresIn = '1h';
    }
    const inputWallet = wallet || from;
    if (!inputWallet || !signature || !message) throw new ValidationError('INVALID_PAYLOAD');
    const isEvmWallet = signMethod === 'personal_sign';
    let signed;
    if (isEvmWallet) {
      signed = checkEvmSignPayload({
        signature, message, inputWallet, signMethod, action: 'authorize',
      });
    } else {
      if (!publicKey) throw new ValidationError('INVALID_PAYLOAD');
      signed = checkCosmosSignPayload({
        signature, publicKey, message, inputWallet, signMethod, action: 'authorize',
      });
    }
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { permissions } = signed;
    const payload: any = { permissions };
    payload.wallet = inputWallet;
    if (isEvmWallet) {
      payload.evmWallet = inputWallet;
      const likeWallet = await findLikeWalletByEvmWallet(inputWallet);
      if (likeWallet) {
        payload.likeWallet = likeWallet;
      }
    } else {
      payload.likeWallet = inputWallet;
    }
    const { token, jwtid } = jwtSign(payload, { expiresIn });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'walletAuthorize',
      wallet: inputWallet,
      jwtid,
      permissions,
      signMethod,
      expiresIn,
      isEvmWallet,
    });

    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

router.post('/evm/migrate/book', async (req, res, next) => {
  try {
    const {
      like_class_id: likeClassId,
      evm_class_id: evmClassId,
    } = req.body;
    if (!likeClassId || !evmClassId) throw new ValidationError('INVALID_PAYLOAD');
    const {
      error,
      migratedClassIds,
      migratedCollectionIds,
    } = await migrateBookClassId(likeClassId, evmClassId);
    res.json({
      migratedClassIds,
      migratedCollectionIds,
      error,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/evm/migrate/user/addr/:likeWallet', async (req, res, next) => {
  try {
    const { likeWallet } = req.params;
    if (!likeWallet || !checkCosmosAddressValid(likeWallet, 'like')) {
      throw new ValidationError('INVALID_PAYLOAD');
    }
    const [likerIdInfo, evmWallet] = await Promise.all([
      getUserWithCivicLikerPropertiesByWallet(likeWallet),
      checkBookUserEvmWallet(likeWallet),
    ]);
    res.json({ likerIdInfo, evmWallet });
  } catch (err) {
    next(err);
  }
});

router.post('/evm/migrate/user', async (req, res, next) => {
  try {
    const {
      cosmos_address: likeWallet,
      cosmos_signature: signature,
      cosmos_public_key: publicKey,
      cosmos_signature_content: message, signMethod,
    } = req.body;
    if (!likeWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
    if (!publicKey) throw new ValidationError('INVALID_PAYLOAD');
    const signed = checkCosmosSignPayload({
      signature, publicKey, message, inputWallet: likeWallet, signMethod, action: 'migrate',
    });
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { evm_wallet: evmWallet } = signed;
    if (!evmWallet || !checkAddressValid(evmWallet)) {
      throw new ValidationError('INVALID_PAYLOAD');
    }
    const {
      isMigratedBookUser,
      isMigratedLikerId,
      isMigratedLikerLand,
      migratedLikerId,
      migratedLikerLandUser,
      migrateBookUserError,
      migrateLikerIdError,
      migrateLikerLandError,
    } = await migrateLikeUserToEvmUser(likeWallet, evmWallet);
    res.json({
      isMigratedBookUser,
      isMigratedLikerId,
      isMigratedLikerLand,
      migratedLikerId,
      migratedLikerLandUser,
      migrateBookUserError,
      migrateLikerIdError,
      migrateLikerLandError,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/evm/migrate/all', async (req, res, next) => {
  try {
    const {
      cosmos_address: likeWallet,
      cosmos_signature: signature,
      cosmos_public_key: publicKey,
      cosmos_signature_content: message, signMethod,
    } = req.body;
    if (!likeWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
    if (!publicKey) throw new ValidationError('INVALID_PAYLOAD');
    const signed = checkCosmosSignPayload({
      signature, publicKey, message, inputWallet: likeWallet, signMethod, action: 'migrate',
    });
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { evm_wallet: evmWallet } = signed;
    if (!evmWallet || !checkAddressValid(evmWallet)) {
      throw new ValidationError('INVALID_PAYLOAD');
    }
    const {
      isMigratedBookUser,
      isMigratedBookOwner,
      isMigratedLikerId,
      isMigratedLikerLand,
      migratedLikerId,
      migratedLikerLandUser,
      migrateBookUserError,
      migrateBookOwnerError,
      migrateLikerIdError,
      migrateLikerLandError,
    } = await migrateLikeWalletToEvmWallet(evmWallet, likeWallet);
    res.json({
      isMigratedBookUser,
      isMigratedBookOwner,
      isMigratedLikerId,
      isMigratedLikerLand,
      migratedLikerId,
      migratedLikerLandUser,
      migrateBookUserError,
      migrateBookOwnerError,
      migrateLikerIdError,
      migrateLikerLandError,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
