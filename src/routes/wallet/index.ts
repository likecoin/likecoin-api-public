import { Router } from 'express';
import { checksumAddress } from 'viem';
import {
  checkCosmosSignPayload,
  checkEVMSignPayload,
  findLikerByEmail,
  getUserWithCivicLikerPropertiesByWallet,
} from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';
import {
  findLikeWalletByEVMWallet,
  checkBookUserEVMWallet,
  migrateBookClassId,
  migrateLikeWalletToEVMWallet,
} from '../../util/api/wallet';
import {
  WalletAuthorizeBodySchema,
  WalletEvmMigrateEmailMagicBodySchema,
  WalletLikeWalletParamsSchema,
} from '../../util/api/wallet/schemas';
import { validateBody, validateParams } from '../../middleware/validate';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { checkAddressValid, checkCosmosAddressValid } from '../../util/ValidationHelper';
import { verifyEmailByMagicDIDToken } from '../../util/magic';
import { createIntercomTokenForUser } from '../../util/intercom';

const router = Router();

router.post('/authorize', validateBody(WalletAuthorizeBodySchema), async (req, res, next) => {
  try {
    const {
      wallet, from, signature, publicKey, message, signMethod,
    } = req.body;
    const expiresIn = req.body.expiresIn || '1h';
    const inputWallet = wallet || from;
    const isEVMWallet = signMethod === 'personal_sign';
    let signed;
    if (isEVMWallet) {
      signed = checkEVMSignPayload({
        signature, message, inputWallet, signMethod, action: 'authorize',
      });
    } else if (checkCosmosAddressValid(inputWallet, 'like')) {
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
      payload.wallet = checksumAddress(inputWallet);
      payload.evmWallet = checksumAddress(inputWallet);
      const likeWallet = await findLikeWalletByEVMWallet(inputWallet);
      if (likeWallet) {
        payload.likeWallet = likeWallet;
      }
    } else {
      payload.likeWallet = inputWallet;
    }

    const likerIdInfo = await getUserWithCivicLikerPropertiesByWallet(inputWallet);
    if (likerIdInfo) {
      payload.user = likerIdInfo.user;
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
    let intercomToken: string | undefined;
    if (likerIdInfo) {
      intercomToken = createIntercomTokenForUser({
        user: likerIdInfo.user,
        email: likerIdInfo.email,
        evmWallet: payload.evmWallet,
      });
    }

    res.json({
      jwtid,
      token,
      intercomToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/evm/migrate/book', async (req, res, next) => {
  try {
    const {
      like_class_id: likeClassId,
      evm_class_id: rawEvmClassId,
    } = req.body;
    if (!likeClassId || !rawEvmClassId) throw new ValidationError('INVALID_PAYLOAD');
    const evmClassId = rawEvmClassId.toLowerCase();
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'migrateBookClassIdBegin',
      likeClassId,
      evmClassId,
    });
    const {
      error,
      migratedClassIds,
    } = await migrateBookClassId(likeClassId, evmClassId);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'migrateBookClassIdEnd',
      likeClassId,
      evmClassId,
      migratedClassIds,
      error,
    });
    res.json({
      migratedClassIds,
      error,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/evm/migrate/user/addr/:likeWallet', validateParams(WalletLikeWalletParamsSchema), async (req, res, next) => {
  try {
    const { likeWallet } = req.params;
    if (!likeWallet || !checkCosmosAddressValid(likeWallet, 'like')) {
      throw new ValidationError('INVALID_PAYLOAD');
    }
    const [likerIdInfo, evmWallet] = await Promise.all([
      getUserWithCivicLikerPropertiesByWallet(likeWallet),
      checkBookUserEVMWallet(likeWallet),
    ]);
    res.json({ likerIdInfo, evmWallet });
  } catch (err) {
    next(err);
  }
});

router.post('/evm/migrate/email/magic', validateBody(WalletEvmMigrateEmailMagicBodySchema), async (req, res, next) => {
  try {
    const {
      wallet: evmWallet,
      signature,
      message,
    } = req.body;
    const migrationMethod = 'auto';
    if (!checkAddressValid(evmWallet)) {
      throw new ValidationError('INVALID_WALLET');
    }
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'migrateLikeUserToEVMUserRequested',
      evmWallet,
      migrationMethod,
    });
    const signed = await checkEVMSignPayload({
      signature,
      message,
      inputWallet: evmWallet,
      signMethod: 'personal_sign',
      action: 'migrate',
    });
    const { email, magicDIDToken } = signed;
    const isEmailVerified = await verifyEmailByMagicDIDToken(email, magicDIDToken);
    if (isEmailVerified) {
      // Find likeWallet by email
      const userInfo = await findLikerByEmail(email);
      if (!userInfo) {
        throw new ValidationError('USER_NOT_FOUND');
      }
      const { likeWallet, evmWallet: docEvmWallet } = userInfo;
      if (docEvmWallet && docEvmWallet !== evmWallet) {
        throw new ValidationError('EVM_WALLET_MISMATCH');
      }
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'migrateLikeUserToEVMUserBegin',
        likeWallet,
        evmWallet,
        migrationMethod,
      });
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
      } = await migrateLikeWalletToEVMWallet(likeWallet as string, evmWallet, migrationMethod);
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'migrateLikeWalletToEVMUserEnd',
        likeWallet,
        evmWallet,
        isMigratedBookUser,
        isMigratedBookOwner,
        isMigratedLikerId,
        isMigratedLikerLand,
        migrationMethod,
        migratedLikerId,
        migratedLikerLandUser,
        migrateBookUserError,
        migrateBookOwnerError,
        migrateLikerIdError,
        migrateLikerLandError,
      });
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
    } else {
      throw new ValidationError('INVALID_EMAIL');
    }
  } catch (err) {
    next(err);
  }
});

router.post(['/evm/migrate/user', '/evm/migrate/all'], async (req, res, next) => {
  try {
    const {
      cosmos_address: likeWallet,
      cosmos_signature: signature,
      cosmos_public_key: publicKey,
      cosmos_signature_content: message, signMethod,
    } = req.body;
    const migrationMethod = 'manual';
    if (!likeWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'migrateLikeUserToEVMUserRequested',
      likeWallet,
      migrationMethod,
    });
    const signed = checkCosmosSignPayload({
      signature, publicKey, message, inputWallet: likeWallet, signMethod, action: 'migrate',
    });
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { evm_wallet: rawEvmWallet } = signed;
    const evmWallet = checksumAddress(rawEvmWallet);
    if (!evmWallet || !checkAddressValid(evmWallet)) {
      throw new ValidationError('INVALID_PAYLOAD');
    }
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'migrateLikeUserToEVMUserBegin',
      likeWallet,
      evmWallet,
      migrationMethod,
    });
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
    } = await migrateLikeWalletToEVMWallet(likeWallet, evmWallet, migrationMethod);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'migrateLikeWalletToEVMUserEnd',
      likeWallet,
      evmWallet,
      isMigratedBookUser,
      isMigratedBookOwner,
      isMigratedLikerId,
      isMigratedLikerLand,
      migrationMethod,
      migratedLikerId,
      migratedLikerLandUser,
      migrateBookUserError,
      migrateBookOwnerError,
      migrateLikerIdError,
      migrateLikerLandError,
    });
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
