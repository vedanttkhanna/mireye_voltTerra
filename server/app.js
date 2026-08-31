import express from 'express';
import { config } from './config.js';
import { countiesRouter } from './routes/counties.js';
import { pipelineRouter } from './routes/pipeline.js';
import { exploreRouter } from './routes/explore.js';
import { chatRouter } from './routes/chat.js';
import { riderRouter } from './routes/rider.js';
import { liveRouter } from './routes/live.js';

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pilot_state: config.pilotState });
});

app.use('/api/counties', countiesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/explore', exploreRouter);
app.use('/api/chat', chatRouter);
app.use('/api/rider', riderRouter);
app.use('/api/live', liveRouter);

export default app;
