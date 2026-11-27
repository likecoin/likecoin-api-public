import { createHmac } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../util/ValidationError';
import { getSlackAttachmentFromError } from '../util/slack';
import { constantTimeEqual } from '../util/misc';

// Slack's recommended replay window for signed requests
const SLACK_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export function isValidSlackSignature({
  signingSecret,
  timestamp,
  signature,
  rawBody,
  now = Date.now(),
}: {
  signingSecret: string;
  timestamp?: string;
  signature?: string;
  rawBody: Buffer;
  now?: number;
}): boolean {
  const timestampSeconds = Number(timestamp);
  if (!signingSecret || !signature || !Number.isInteger(timestampSeconds)) return false;
  if (Math.abs(now / 1000 - timestampSeconds) > SLACK_SIGNATURE_MAX_AGE_SECONDS) return false;
  const digest = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:`)
    .update(rawBody)
    .digest('hex');
  return constantTimeEqual(signature, `v0=${digest}`);
}

// The signature covers the raw form body, so capture it while parsing
const parseSlackFormWithRawBody = express.urlencoded({
  extended: false,
  verify: (r, _, buf) => {
    const raw = r as Request & { rawBody?: Buffer };
    raw.rawBody = buf;
  },
});

// An empty secret rejects every request
export const slackSignatureChecker = (
  signingSecret: string,
) => (req: Request, res: Response, next: NextFunction): void => {
  parseSlackFormWithRawBody(req, res, (e) => {
    if (e) {
      next(e);
      return;
    }
    const { rawBody } = req as Request & { rawBody?: Buffer };
    if (!rawBody || !isValidSlackSignature({
      signingSecret,
      timestamp: req.get('X-Slack-Request-Timestamp'),
      signature: req.get('X-Slack-Signature'),
      rawBody,
    })) {
      res.sendStatus(401);
      return;
    }
    next();
  });
};

export const slackTokenChecker = (
  token: string,
  channelIds: string[],
  userIds: string[],
) => (req: Request, res: Response, next: NextFunction): void => {
  express.urlencoded({ extended: false })(req, res, (e) => {
    if (e) {
      next(e);
      return;
    }
    try {
      if (!req.body.token || req.body.token !== token) throw new ValidationError('Wrong token');
      if (!req.body.channel_id || !channelIds.includes(req.body.channel_id)) throw new ValidationError('Invalid channel');
      if (!req.body.user_id || !userIds.includes(req.body.user_id)) throw new ValidationError('Invalid user');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.json({
        response_type: 'ephemeral',
        text: `Command failed: ${(err as any).message || err}`,
      });
      return;
    }
    next();
  });
};

export interface SlackCommandContext {
  command: string;
  params: string[];
  req: Request;
  res: Response;
}

export type SlackCommandFn = (ctx: SlackCommandContext) => void | Promise<unknown>;

// Text pasted from a Slack message keeps its formatting:
// backticks from inline code or code blocks,
// and `<mailto:a@b.co|…>` or `<https://…|label>` wrappers when links are escaped.
// Unwrap to the raw address or URL so params match as typed;
// user and channel mentions (`<@U…>`, `<#C…>`) are left alone.
export function normalizeSlackCommandText(text: string): string {
  return text
    .replace(/<(?:mailto:)?([^<>|@#!][^<>|]*)(?:\|[^<>]*)?>/g, '$1')
    .replace(/`/g, '');
}

// Slack sends the slash command as typed, e.g. `/user_test` from the testnet app,
// so messages echo it back instead of the production name.
export const slackCommandHandler = (
  defaultCommand: string,
  commands: Record<string, SlackCommandFn>,
  getInvalidCommandMessage: (command: string) => string = () => 'Invalid command',
) => async (req: Request, res: Response): Promise<void> => {
  try {
    const command = req.body.command || defaultCommand;
    const text = normalizeSlackCommandText(req.body.text || '').trim();
    const [subcommand, ...params] = text ? text.split(/\s+/) : ['help'];
    const commandFn = Object.prototype.hasOwnProperty.call(commands, subcommand)
      ? commands[subcommand]
      : null;
    if (!commandFn) throw new Error(getInvalidCommandMessage(command));
    await commandFn({
      command, params, req, res,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    res.json({
      response_type: 'ephemeral',
      attachments: [getSlackAttachmentFromError((err as any).message || err)],
    });
  }
};

export default slackTokenChecker;
