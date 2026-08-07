import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import type { UserData } from '../../types/user';
import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../util/firebase';
import publisher from '../../util/gcloudPub';
import { sendVerificationEmail } from '../../util/sendgrid';
import { ValidationError } from '../../util/ValidationError';
import { validateParams, validateBody } from '../../middleware/validate';
import { sendValidatedJSON } from '../../util/ValidationHelper';
import verifyEmailByUUID from '../../util/api/email/verify';
import { renderEmailVerifyPage, type EmailVerifyPageStatus } from '../../util/api/email/verifyPage';
import { resolveLocale } from '../../locales';
import {
  EmailVerifyUserParamsSchema,
  EmailVerifyUserBodySchema,
  EmailVerifyParamsSchema,
  EmailVerifyResponseSchema,
} from '../../util/api/email/schemas';

const THIRTY_S_IN_MS = 30000;

const router = Router();

router.post('/verify/user/:id/', validateParams(EmailVerifyUserParamsSchema), validateBody(EmailVerifyUserBodySchema), async (req, res, next) => {
  try {
    const { id: username } = req.params as Record<string, string>;
    const userRef = dbRef.doc(username);
    const doc = await userRef.get();
    let user: UserData = {} as UserData;
    let verificationUUID: string | undefined;
    if (doc.exists) {
      user = doc.data() as UserData;
      if (!user.email) throw new ValidationError('Invalid email');
      if (user.isEmailVerified) throw new ValidationError('Already verified');
      if (user.lastVerifyTs && Math.abs(user.lastVerifyTs - Date.now()) < THIRTY_S_IN_MS) {
        throw new ValidationError('An email has already been sent recently, Please try again later');
      }
      ({ verificationUUID } = user);
      if (!verificationUUID) {
        verificationUUID = uuidv4();
        user.verificationUUID = verificationUUID;
      }
      await userRef.update({
        lastVerifyTs: Date.now(),
        verificationUUID,
      });
      try {
        await sendVerificationEmail(res, user);
      } catch (err) {
        await userRef.update({
          lastVerifyTs: FieldValue.delete(),
          verificationUUID: FieldValue.delete(),
        });
        throw err;
      }
    } else {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(200);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventSendVerifyEmail',
      user: username,
      email: user.email,
      displayName: user.displayName,
      wallet: user.wallet,
      avatar: user.avatar,
      verificationUUID,
      referrer: user.referrer,
      locale: user.locale,
      registerTime: user.timestamp,
    });
  } catch (err) {
    next(err);
  }
});

const VERIFY_PAGE_HTTP_STATUS: Record<EmailVerifyPageStatus, number> = {
  success: 200,
  failed: 404,
  error: 500,
};

// One-click link from the verification email. A mail client follows it as a
// plain GET, so every outcome renders HTML - errorHandler would answer JSON,
// hence the local try/catch instead of next(err).
router.get('/verify/:uuid', validateParams(EmailVerifyParamsSchema), async (req, res) => {
  const verificationUUID = req.params.uuid;
  let status: EmailVerifyPageStatus = 'error';
  let user: UserData | null = null;
  try {
    user = await verifyEmailByUUID(req, verificationUUID);
    status = user ? 'success' : 'failed';
  } catch (err) {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventVerifyEmailError',
      verificationUUID,
      error: (err as Error).message,
    });
  }
  res.setLocale(resolveLocale(req.query.lang, user?.locale));
  res.set('Cache-Control', 'no-store');
  res.status(VERIFY_PAGE_HTTP_STATUS[status]).type('html').send(renderEmailVerifyPage(res, status));
});

router.post('/verify/:uuid', validateParams(EmailVerifyParamsSchema), async (req, res, next) => {
  try {
    const user = await verifyEmailByUUID(req, req.params.uuid);
    if (!user) {
      res.sendStatus(404);
      return;
    }
    sendValidatedJSON(res, EmailVerifyResponseSchema, {
      referrer: !!user.referrer,
      wallet: user.wallet,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
