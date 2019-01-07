import express from 'express';
import axiosist from 'axiosist';
import allRoutes from '../../src/routes/all';
import errorHandler from '../../src/middleware/errorHandler';

const app = express();
app.use('/api', allRoutes);

app.use(errorHandler);

const axios = axiosist(app);

export default axios;
