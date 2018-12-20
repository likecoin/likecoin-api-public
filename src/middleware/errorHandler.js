import { ValidationError } from '../util/ValidationError';

export default function errorHandler(err, req, res, next) {
  const msg = (err.response && err.response.data) || err.message || err;
  console.error(msg);
  if (res.headersSent) {
    return next(err);
  }
  if (err instanceof ValidationError) {
    res.set('Content-Type', 'text/plain');
    return res.status(400).send(msg);
  }
  // Handle multer error
  if (err.code) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.set('Content-Type', 'text/plain');
      return res.status(400).send('FILE_TOO_LARGE');
    }
    if (err.code === 'EBADCSRFTOKEN') {
      res.set('Content-Type', 'text/plain');
      return res.status(400).send('BAD_CSRF_TOKEN');
    }
  }
  return res.sendStatus(500);
}
