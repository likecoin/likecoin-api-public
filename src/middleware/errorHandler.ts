import axios from 'axios';
import { ValidationError } from '../util/ValidationError';

export default function errorHandler(err, req, res, next) {
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
    return next(err);
  }
  res.set('Content-Type', 'text/plain');
  if (err instanceof ValidationError) {
    if (err.payload) {
      return res.status(err.status).json({
        ...err.payload,
        error: err.message,
      });
    }
    return res.status(err.status).send(err.message);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).send('BODY_PARSE_FAILED');
  }
  // Handle multer error
  if (err.code) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('FILE_TOO_LARGE');
    }
  }
  return res.sendStatus(500);
}
