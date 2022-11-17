import express, { Request } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import cors from 'cors';
import i18n from 'i18n';
import { supportedLocales } from './locales';

import errorHandler from './middleware/errorHandler';
import allRoutes from './routes/all';

const app = express();

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
app.set('port', port);

if (process.env.NODE_ENV === 'production') app.disable('x-powered-by');

i18n.configure({
  locales: supportedLocales,
  directory: path.resolve(__dirname, './locales'),
  objectNotation: true,
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(bodyParser.json({
  verify: (req, _, buf) => {
    let r: Request = req as any;
    if (r.path.includes('/stripe/webhook')) { // rawbody is needed for stripe webhook
      r.rawBody = buf;
    }
  },
}));
app.use(i18n.init);
app.use((req, res, next) => {
  if (req.body.locale) req.setLocale(req.body.locale);
  next();
});

app.use(allRoutes);

app.get('/healthz', (req, res) => {
  res.sendStatus(200);
});

app.use(errorHandler);

app.listen(port, host);

console.log(`Server listening on ${host}:${port}`); // eslint-disable-line no-console
