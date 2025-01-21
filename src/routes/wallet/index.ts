import { Router } from 'express';
import { checkCosmosSignPayload, checkEVMSignPayload } from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';
import { findLikeWalletByEVMWallet, migrateLikeWalletToEVMWallet } from '../../util/api/wallet';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { isValidLikeAddress } from '../../util/cosmos';

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
    const isEVMWallet = signMethod === 'personal_sign';
    let signed;
    if (isEVMWallet) {
      signed = checkEVMSignPayload({
        signature, message, inputWallet, signMethod, action: 'authorize',
      });
    } else if (isValidLikeAddress(inputWallet)) {
      if (!publicKey) throw new ValidationError('INVALID_PAYLOAD');
      signed = checkCosmosSignPayload({
        signature, publicKey, message, inputWallet, signMethod, action: 'authorize',
      });
    } else {
      throw new ValidationError('INVALID_WALLET');
    }
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { permissions } = signed;
    const payload: any = { permissions };
    payload.wallet = inputWallet;
    if (isEVMWallet) {
      payload.evmWallet = inputWallet;
      const likeWallet = await findLikeWalletByEVMWallet(inputWallet);
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
      isEVMWallet,
    });

    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

router.post('/evm/migrate', async (req, res, next) => {
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
    if (!evmWallet) {
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
    } = await migrateLikeWalletToEVMWallet(evmWallet, likeWallet);
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
