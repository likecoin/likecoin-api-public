import express from 'express';
import cors from 'cors';

import errorHandler from './middleware/errorHandler';
import allRoutes from './routes/all';

const app = express();

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 3000;
app.set('port', port);

app.use(cors({ origin: true, credentials: true }));
app.use(allRoutes);

app.get('/healthz', (req, res) => {
  res.sendStatus(200);
});

app.use(errorHandler);


app.listen(port, host);

console.log(`Server listening on ${host}:${port}`); // eslint-disable-line no-console
