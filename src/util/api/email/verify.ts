import type { Request } from 'express';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import type { UserData } from '../../../types/user';
import {
  userCollection as dbRef,
  FieldValue,
} from '../../firebase';
import publisher from '../../gcloudPub';

/**
 * Consumes a verification UUID, returning the user or null when no doc matches.
 * The UUID is kept after success so a repeat click - or a mail scanner
 * prefetching the link - still resolves. Anything resetting `isEmailVerified`
 * must therefore clear `verificationUUID` too.
 */
export default async function verifyEmailByUUID(
  req: Request,
  verificationUUID: string,
): Promise<UserData | null> {
  const query = await dbRef.where('verificationUUID', '==', verificationUUID).limit(1).get();
  if (!query.docs.length) return null;

  const [doc] = query.docs;
  const user = doc.data() as UserData;
  if (user.isEmailVerified) return user;

  await Promise.all([
    doc.ref.update({
      lastVerifyTs: FieldValue.delete(),
      isEmailVerified: true,
      emailVerifiedTs: Date.now(),
    }),
    // Best-effort denormalization: the referral doc is missing for users whose
    // referrer was removed, and a failure here must not undo the verification.
    user.referrer
      ? dbRef.doc(user.referrer).collection('referrals').doc(doc.id).update({ isEmailVerified: true })
        .catch((err) => publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'eventVerifyEmailReferralError',
          user: doc.id,
          referrer: user.referrer,
          error: (err as Error).message,
        }))
      : Promise.resolve(),
  ]);

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventVerify',
    user: doc.id,
    email: user.email,
    displayName: user.displayName,
    wallet: user.wallet,
    avatar: user.avatar,
    verificationUUID,
    referrer: user.referrer,
    locale: user.locale,
    registerTime: user.timestamp,
  });

  return user;
}
