import { Request, Response, NextFunction } from 'express';

// express.json (body-parser 2.x) leaves req.body undefined on bodyless / non-JSON
// requests; restore the always-{} contract downstream code relies on.
export default function normalizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body === undefined) req.body = {};
  next();
}
