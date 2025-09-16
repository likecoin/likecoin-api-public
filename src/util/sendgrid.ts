/* eslint-disable no-underscore-dangle */
import { getBasicTemplate } from '@likecoin/edm';
import sgMail from '@sendgrid/mail';
import {
  SENDGRID_API_KEY,
} from '../../config/config';

sgMail.setApiKey(SENDGRID_API_KEY);

export async function sendVerificationEmail(res, user, ref) {
  const msg = {
    from: 'Liker Land <noreply@liker.land>',
    to: user.email,
    subject: res.__('Email.VerifiyEmail.subject'),
    html: getBasicTemplate({
      title: res.__('Email.VerifiyEmail.subject'),
      content: res.__('Email.VerifiyEmail.body', {
        name: user.displayName,
        uuid: user.verificationUUID,
        ref,
      }) + res.__('Email.signature'),
    }).body,
  };
  return sgMail.send(msg);
}

export default sendVerificationEmail;
