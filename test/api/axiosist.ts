import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import axiosist from 'axiosist';
import i18n from 'i18n';
import allRoutes from '../../src/routes/all';
import errorHandler from '../../src/middleware/errorHandler';
import { supportedLocales } from '../../src/locales';

const path = require('path');

i18n.configure({
  locales: supportedLocales,
  directory: path.resolve(__dirname, '../../src/locales'),
  objectNotation: true,
});

const app = express();
app.use(cookieParser());
app.use(bodyParser.json());
app.use(i18n.init);
app.use('/api', allRoutes);

app.use(errorHandler);

const axios = axiosist(app);

export default axios;
