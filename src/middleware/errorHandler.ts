import axios from 'axios';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../util/ValidationError';

export default function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof ValidationError) {
    if (err.status !== 404) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        message: (err as Error).message,
        path: req.path,
      }));
    }
  } else if (axios.isAxiosError(err)) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      path: req.path,
      message: err,
      stack: (err as Error).stack,
    }));
  } else {
    // eslint-disable-next-line no-console
    console.error(`Path: ${req.path}`);
    // eslint-disable-next-line no-console
    console.error(err);
  }
  if (res.headersSent) {
    next(err);
  } else {
    res.set('Content-Type', 'text/plain');
    if (err instanceof ValidationError) {
      if (err.payload) {
        res.status(err.status).json({
          ...err.payload,
          error: err.message,
        });
      } else {
        res.status(err.status).send(err.message);
      }
    } else if ((err as Record<string, unknown>).type === 'entity.parse.failed') {
      res.status(400).send('BODY_PARSE_FAILED');
    } else if ((err as Record<string, unknown>).code === 'LIMIT_FILE_SIZE') {
      // Handle multer error
      res.status(400).send('FILE_TOO_LARGE');
    } else {
      res.sendStatus(500);
    }
  }
}
