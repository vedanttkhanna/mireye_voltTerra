import express from 'express';
import { config } from './config.js';
import { countiesRouter } from './routes/counties.js';
import { pipelineRouter } from './routes/pipeline.js';
import { exploreRouter } from './routes/explore.js';
import { operatorRateLimit, requireOperatorForUnsafeMethods } from './middleware/operator.js';

const app = express();
app.use(express.json());
app.use('/api', requireOperatorForUnsafeMethods, operatorRateLimit);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pilot_state: config.pilotState, operator_actions_enabled: Boolean(config.operatorKey) });
});

app.use('/api/counties', countiesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/explore', exploreRouter);

app.listen(config.port, config.host, () => {
  console.log(`VOLT-TERRA backend listening on http://${config.host}:${config.port}`);
});
