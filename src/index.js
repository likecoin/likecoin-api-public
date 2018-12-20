import express from 'express';
import misc from './routes/misc';

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 3000;

app.set('port', port);
app.use('/misc', misc);


app.get('/healthz', (req, res) => {
  res.sendStatus(200);
});

app.listen(port, host);

console.log(`Server listening on ${host}:${port}`); // eslint-disable-line no-console
