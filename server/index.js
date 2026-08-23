import express from 'express';
import { config } from './config.js';
import { countiesRouter } from './routes/counties.js';
import { pipelineRouter } from './routes/pipeline.js';
import { exploreRouter } from './routes/explore.js';
import { chatRouter } from './routes/chat.js';

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pilot_state: config.pilotState });
});

app.use('/api/counties', countiesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/explore', exploreRouter);
app.use('/api/chat', chatRouter);

app.listen(config.port, () => {
  console.log(`VOLT-TERRA backend listening on http://localhost:${config.port}`);
});
