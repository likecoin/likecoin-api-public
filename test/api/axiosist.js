import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import axiosist from 'axiosist';
import allRoutes from '../../src/routes/all';
import errorHandler from '../../src/middleware/errorHandler';

const app = express();
app.use(cookieParser());
app.use(bodyParser.json());
app.use('/api', allRoutes);

app.use(errorHandler);

const axios = axiosist(app);

export default axios;
