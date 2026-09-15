import express, { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../util/ValidationError';
import { getSlackAttachmentFromError } from '../util/slack';

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

export const slackCommandHandler = (
  commands: Record<string, SlackCommandFn>,
  invalidCommandMessage = 'Invalid command',
) => async (req: Request, res: Response): Promise<void> => {
  try {
    const text = normalizeSlackCommandText(req.body.text || '').trim();
    const [command, ...params] = text ? text.split(/\s+/) : ['help'];
    const commandFn = Object.prototype.hasOwnProperty.call(commands, command)
      ? commands[command]
      : null;
    if (!commandFn) throw new Error(invalidCommandMessage);
    await commandFn({ params, req, res });
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
