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
