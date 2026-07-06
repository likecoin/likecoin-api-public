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

export const slackCommandHandler = (
  commands: Record<string, SlackCommandFn>,
  invalidCommandMessage = 'Invalid command',
) => async (req: Request, res: Response): Promise<void> => {
  try {
    const [command, ...params] = req.body.text ? req.body.text.trim().split(/\s+/) : ['help'];
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
