import { Router } from 'express';
import { runAutonomousAgent } from '../services/llm-agent.js';
import { conflictWhileRunning, rateLimit } from '../lib/operation-guard.js';

export const chatRouter = Router();

// POST /api/chat — autonomous agent feasibility inquiry with MCP tools and cited evidence
chatRouter.post('/', rateLimit({ name: 'chat', max: 12, windowMs: 60 * 60_000 }), conflictWhileRunning('chat', async (req, res) => {
  const { message, county_fips, coordinates, history = [] } = req.body ?? {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'invalid_input', detail: 'message field is required' });
  }
  if (!Array.isArray(history) || history.length > 6 || history.some((item) =>
    !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 1500
  )) {
    return res.status(400).json({ error: 'invalid_input', detail: 'history must contain at most 6 user/assistant messages of 1500 characters each' });
  }

  try {
    const result = await runAutonomousAgent({
      message: message.trim(),
      countyFips: county_fips,
      coordinates,
      history,
    });

    res.json(result);
  } catch (err) {
    console.error('[chat]', err);
    res.status(502).json({ error: 'agent_query_failed' });
  }
}));
