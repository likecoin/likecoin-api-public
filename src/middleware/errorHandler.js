import { ValidationError } from '../util/ValidationError';

export default function errorHandler(err, req, res, next) {
  const msg = (err.response && err.response.data) || err;
  if (err instanceof ValidationError) {
    console.error(err.message);
  } else {
    console.error(msg);
  }
  if (res.headersSent) {
    return next(err);
  }
  res.set('Content-Type', 'text/plain');
  if (err instanceof ValidationError) {
    return res.status(400).send(err.message);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).send('BODY_PARSE_FAILED');
  }
  // Handle multer error
  if (err.code) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('FILE_TOO_LARGE');
    }
    if (err.code === 'EBADCSRFTOKEN') {
      return res.status(400).send('BAD_CSRF_TOKEN');
    }
  }
  return res.sendStatus(500);
}
