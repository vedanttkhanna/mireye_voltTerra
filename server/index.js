import express from 'express';
import { config } from './config.js';
import { countiesRouter } from './routes/counties.js';
import { pipelineRouter } from './routes/pipeline.js';
import { exploreRouter } from './routes/explore.js';
import { actionRateLimit } from './middleware/action-rate-limit.js';

const app = express();
app.use(express.json());
app.use('/api', actionRateLimit);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pilot_state: config.pilotState });
});

app.use('/api/counties', countiesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/explore', exploreRouter);

app.listen(config.port, config.host, () => {
  console.log(`VOLT-TERRA backend listening on http://${config.host}:${config.port}`);
});
