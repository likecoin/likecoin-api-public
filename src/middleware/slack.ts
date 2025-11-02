import { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { ValidationError } from '../util/ValidationError';

export const slackTokenChecker = (
  token: string,
  channelIds: string[],
  userIds: string[],
) => (req: Request, res: Response, next: NextFunction): void => {
  bodyParser.urlencoded({ extended: false })(req, res, (e) => {
    try {
      if (!req.body.token || req.body.token !== token) next(new ValidationError('Wrong token'));
      if (!req.body.channel_id || !channelIds.includes(req.body.channel_id)) next(new ValidationError('Invalid channel'));
      if (!req.body.user_id || !userIds.includes(req.body.user_id)) next(new ValidationError('Invalid user'));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.json({
        response_type: 'ephemeral',
        text: `Command failed: ${(err as any).message || err}`,
      });
    }
    next(e);
  });
};

export default slackTokenChecker;
