import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3000,

  mireyeApiKey: required('MIREYE_API_KEY'),
  mireyeBaseUrl: process.env.MIREYE_BASE_URL || 'https://api.mireye.com',
  // Optional LLM API keys for autonomous decision agent
  llmProvider: process.env.LLM_PROVIDER || 'auto',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 90_000,
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  groqTimeoutMs: Number(process.env.GROQ_TIMEOUT_MS) || 90_000,
  groqMaxCompletionTokens: Number(process.env.GROQ_MAX_COMPLETION_TOKENS) || 2800,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // developer.nrel.gov retired May 2026; AFDC now serves from developer.nlr.gov.
  nrelApiKey: process.env.NREL_API_KEY || 'DEMO_KEY',
  afdcBaseUrl: process.env.AFDC_BASE_URL || 'https://developer.nlr.gov',
  // ACS now requires a free Census API key. A live sweep still runs without
  // one using the bundled Census population reference, but exposes that
  // provenance rather than presenting it as a fresh population pull.
  censusApiKey: process.env.CENSUS_API_KEY || '',
  censusAcsBaseUrl: process.env.CENSUS_ACS_BASE_URL || 'https://api.census.gov/data/2024/acs/acs5',

  pilotState: process.env.PILOT_STATE || 'CA',
  underservedThresholdMultiplier: Number(process.env.UNDERSERVED_THRESHOLD_MULTIPLIER) || 1.5,

  // Safety cap on a single runFullSweep() call, checked against the live
  // /v1/fetch/quote before any metered call runs. Guards against a
  // misconfigured field list or sample size accidentally burning the whole
  // monthly allowance (25,000 on the build plan) in one run.
  maxSweepCredits: Number(process.env.MAX_SWEEP_CREDITS) || 15000,
  maxPointCheckCredits: Number(process.env.MAX_POINT_CHECK_CREDITS) || 50,

  // Ceiling on live Mireye spend within a single chat answer. The agent can
  // escalate to metered tools on its own initiative, so this bounds the blast
  // radius of one badly-judged escalation (or a prompt-injected one) to a
  // couple of points rather than the remaining monthly allowance.
  maxChatCredits: Number(process.env.MAX_CHAT_CREDITS) || 1500,

  // Concurrent /v1/fetch/batch requests for a statewide run. Four is far
  // below Mireye's 60 req/min cap while removing the avoidable serial wait.
  liveSweepConcurrency: Math.min(6, Math.max(1, Number(process.env.LIVE_SWEEP_CONCURRENCY) || 4)),
};
