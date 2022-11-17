import { ValidationError } from '../util/ValidationError';

export default function errorHandler(err, req, res, next) {
  if (err instanceof ValidationError) {
    // eslint-disable-next-line no-console
    if (err.status !== 404) console.error(JSON.stringify((err as Error).message));
  } else {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      message: err, stack: (err as Error).stack,
    }));
  }
  if (res.headersSent) {
    return next(err);
  }
  res.set('Content-Type', 'text/plain');
  if (err instanceof ValidationError) {
    return res.status(err.status).send((err as Error).message);
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
