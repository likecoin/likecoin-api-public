/* eslint-disable no-underscore-dangle */
import { getBasicV2Template } from '@likecoin/edm';
import sgMail from '@sendgrid/mail';
import {
  SENDGRID_API_KEY,
} from '../../config/config';

sgMail.setApiKey(SENDGRID_API_KEY);

export async function sendVerificationEmail(res, user, ref) {
  const subject = res.__('Email.VerifyEmail.subject');
  const msg = {
    from: 'Liker Land <noreply@liker.land>',
    to: user.email,
    subject,
    html: getBasicV2Template({
      title: subject,
      content: res.__('Email.VerifyEmail.body', {
        name: user.displayName,
        uuid: user.verificationUUID,
        ref,
      }) + res.__('Email.signature'),
    }).body,
  };
  return sgMail.send(msg);
}

export default sendVerificationEmail;
