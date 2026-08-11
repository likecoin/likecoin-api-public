import { Router } from 'express';

import { jwtAuth } from '../../middleware/jwt';
import { validateBody, validateParams } from '../../middleware/validate';
import { sendValidatedJSON } from '../../util/ValidationHelper';
import {
  UsersHandleAvailabilityResponseSchema,
  UsersHandleResponseSchema,
  UsersHandleSchema,
} from '../../util/api/users/schemas';
import {
  isHandleAvailable,
  normalizeHandle,
  renameUserHandle,
} from '../../util/api/users/handle';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

const router = Router();

router.get('/handle/:handle/available', validateParams(UsersHandleSchema), async (req, res, next) => {
  try {
    const handle = normalizeHandle(req.params.handle as string);
    sendValidatedJSON(res, UsersHandleAvailabilityResponseSchema, {
      handle,
      isAvailable: await isHandleAvailable(handle),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/handle', jwtAuth('write'), validateBody(UsersHandleSchema), async (req, res, next) => {
  try {
    const { user } = req.user;
    const { handle: newHandleInput } = req.body;
    const { oldHandle, newHandle } = await renameUserHandle(user, newHandleInput);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventUserHandleChange',
      user,
      handle: newHandle,
      previousHandle: oldHandle,
    });
    sendValidatedJSON(res, UsersHandleResponseSchema, {
      user,
      handle: newHandle,
      previousHandle: oldHandle,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
