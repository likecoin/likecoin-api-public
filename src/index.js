import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import bodyParser from 'body-parser';
import cors from 'cors';
import i18n from 'i18n';
import { supportedLocales } from './locales';

import errorHandler from './middleware/errorHandler';
import allRoutes from './routes/all';

const path = require('path');

const app = express();

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 3000;
app.set('port', port);

i18n.configure({
  locales: supportedLocales,
  directory: path.resolve(__dirname, './locales'),
  objectNotation: true,
});

app.use(cors({ origin: true, credentials: true }));
app.use((req, res, next) => {
  if (!/^\/in\/embed\/[-a-z0-9_]+/.test(req.path)) {
    res.setHeader('X-Frame-Options', 'DENY');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600, stale-if-error=604800, stale-while-revalidate=604800');
  }
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin');
  next();
});

app.use(cookieParser());
app.use(compression());
app.use(bodyParser.json());
app.use(i18n.init);
app.use((req, res, next) => {
  if (req.body.locale) req.setLocale(res, req.body.locale);
  next();
});

app.use(allRoutes);

app.get('/healthz', (req, res) => {
  res.sendStatus(200);
});

app.use(errorHandler);


app.listen(port, host);

console.log(`Server listening on ${host}:${port}`); // eslint-disable-line no-console
