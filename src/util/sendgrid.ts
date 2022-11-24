/* eslint-disable no-underscore-dangle */
import EmailTemplate from '@likecoin/likecoin-email-templates';
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
    html: EmailTemplate.Basic({
      title: res.__('Email.VerifiyEmail.subject'),
      body: res.__('Email.VerifiyEmail.body', {
        name: user.displayName,
        uuid: user.verificationUUID,
        ref,
      }) + res.__('Email.signature'),
    }),
  };
  return sgMail.send(msg);
}

export async function sendVerificationWithCouponEmail(res, user, coupon, ref) {
  const msg = {
    from: 'Liker Land <noreply@liker.land>',
    to: user.email,
    subject: res.__('Email.VerifiyAndCouponEmail.subject'),
    html: EmailTemplate.Basic({
      title: res.__('Email.VerifiyAndCouponEmail.subject'),
      body: res.__('Email.VerifiyAndCouponEmail.body', {
        name: user.displayName,
        uuid: user.verificationUUID,
        coupon,
        ref,
      }) + res.__('Email.signature'),
    }),
  };
  return sgMail.send(msg);
}

export async function sendInvitationEmail(res, { email, referrerId, referrer }) {
  const title = res.__('Email.InvitationEmail.subject', { referrer });
  const msg = {
    from: 'Liker Land <noreply@liker.land>',
    to: email,
    subject: title,
    html: EmailTemplate.Basic({
      title,
      body: res.__('Email.InvitationEmail.body', {
        referrerId,
        referrer,
        email,
      }) + res.__('Email.signature'),
    }),
  };
  return sgMail.send(msg);
}
