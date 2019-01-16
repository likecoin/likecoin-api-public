/* eslint-disable no-underscore-dangle */
import EmailTemplate from '@likecoin/likecoin-email-templates';
import { TEST_MODE } from '../constant';

const aws = require('aws-sdk');

if (!TEST_MODE) aws.config.loadFromPath('config/aws.json');

const ses = new aws.SES();

export async function sendVerificationEmail(res, user, ref) {
  const params = {
    Source: '"LikeCoin Foundation" <noreply@like.co>',
    Destination: {
      ToAddresses: [user.email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: res.__('Email.VerifiyEmail.subject'),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: EmailTemplate.Basic({
            title: res.__('Email.VerifiyEmail.subject'),
            body: res.__('Email.VerifiyEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              ref,
            }) + res.__('Email.signature'),
          }),
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendVerificationWithCouponEmail(res, user, coupon, ref) {
  const params = {
    Source: '"LikeCoin Foundation" <noreply@like.co>',
    Destination: {
      ToAddresses: [user.email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: res.__('Email.VerifiyAndCouponEmail.subject'),
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: EmailTemplate.Basic({
            title: res.__('Email.VerifiyAndCouponEmail.subject'),
            body: res.__('Email.VerifiyAndCouponEmail.body', {
              name: user.displayName,
              uuid: user.verificationUUID,
              coupon,
              ref,
            }) + res.__('Email.signature'),
          }),
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}

export async function sendInvitationEmail(res, { email, referrerId, referrer }) {
  const title = res.__('Email.InvitationEmail.subject', { referrer });
  const params = {
    Source: '"LikeCoin Foundation" <noreply@like.co>',
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: title,
      },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: EmailTemplate.Basic({
            title,
            body: res.__('Email.InvitationEmail.body', {
              referrerId,
              referrer,
              email,
            }) + res.__('Email.signature'),
          }),
        },
      },
    },
  };
  return ses.sendEmail(params).promise();
}
