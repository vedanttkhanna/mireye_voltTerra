import { Router } from 'express';
import { runAutonomousAgent } from '../services/llm-agent.js';

export const chatRouter = Router();

// POST /api/chat — autonomous agent feasibility inquiry with MCP tools and cited evidence
chatRouter.post('/', async (req, res) => {
  const { message, county_fips, coordinates } = req.body ?? {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'invalid_input', detail: 'message field is required' });
  }

  try {
    const result = await runAutonomousAgent({
      message: message.trim(),
      countyFips: county_fips,
      coordinates,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'agent_query_failed', detail: err.message });
  }
});
