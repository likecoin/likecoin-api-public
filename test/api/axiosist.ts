import express from 'express';
import cookieParser from 'cookie-parser';
import axiosist from 'axiosist';
import i18n from 'i18n';
import path from 'path';
import allRoutes from '../../src/routes/all';
import errorHandler from '../../src/middleware/errorHandler';
import normalizeBody from '../../src/middleware/normalizeBody';
import { supportedLocales } from '../../src/locales';

i18n.configure({
  locales: supportedLocales,
  directory: path.resolve(__dirname, '../../src/locales'),
  objectNotation: true,
});

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(normalizeBody);
app.use(i18n.init);
app.use('/api', allRoutes);

app.use(errorHandler);

const axios = axiosist(app);

export default axios;
