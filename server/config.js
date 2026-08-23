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
  // Never reuse or expose the upstream Mireye credential in browser code.
  operationApiKey: process.env.OPERATION_API_KEY || '',

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

  pilotState: process.env.PILOT_STATE || 'CA',
  underservedThresholdMultiplier: Number(process.env.UNDERSERVED_THRESHOLD_MULTIPLIER) || 2.0,

  // Safety cap on a single runFullSweep() call, checked against the live
  // /v1/fetch/quote before any metered call runs. Guards against a
  // misconfigured field list or sample size accidentally burning the whole
  // monthly allowance (25,000 on the build plan) in one run.
  maxSweepCredits: Number(process.env.MAX_SWEEP_CREDITS) || 15000,
  maxPointCheckCredits: Number(process.env.MAX_POINT_CHECK_CREDITS) || 50,
};
