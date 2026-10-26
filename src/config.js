// Settings, the role -> skill map and the list of our agents. Every tunable number lives here.
import 'dotenv/config';

export const CONFIG = {
  MAX_CANDIDATES: 8,        // trialled per role
  MIN_SCORE: 40,            // average feedback below this = skip...
  MIN_FEEDBACKS: 3,         // ...but only once there are this many ratings, so one unlucky trial is not a ban
  ALIVE_TIMEOUT_MS: 5000,
  TRIAL_TIMEOUT_MS: 15000,
  TASK_TIMEOUT_MS: 20000,
  BREAKER_FAILS: 3,         // consecutive bad replies before an agent is marked dead
  SUBQUESTIONS: 3,
  THIRD_PARTY_RETRIEVERS: 3, // real registry agents from other people, trialled as retrievers
  INDEXER: 'https://8004-indexer-dev.qnt.sh/v2/graphql',
  MODEL: process.env.MODEL || 'claude-opus-5-5',
  LLM: process.env.LLM !== 'off', // LLM=off runs the agents and planner on rules (src/rules.js)
  PORT: Number(process.env.PORT || 3001),
  AGENTS_BASE_URL: (process.env.AGENTS_BASE_URL || 'http://localhost:3001').replace(/\/$/, ''),
};

export const ROLE_SKILLS = {
  retriever: ['natural_language_processing/information_retrieval_synthesis/search'],
  verifier: ['natural_language_processing/analytical_reasoning/fact_verification'],
  writer: ['natural_language_processing/natural_language_generation/summarization'],
};

export const ROLES = Object.keys(ROLE_SKILLS);

// Our agents. Handlers live in src/agents.js; this list is shared with scripts/register.js.
export const AGENT_LIST = [
  { name: 'retriever-a', role: 'retriever', description: 'Finds facts on Wikipedia and returns each with an exact quote and source URL.' },
  { name: 'retriever-b', role: 'retriever', description: 'Backup retriever: Wikipedia facts with exact quotes, tuned for short answers.' },
  { name: 'verifier-a', role: 'verifier', description: 'Checks that a quote is on its source page and that it supports the claim.' },
  { name: 'writer-a', role: 'writer', description: 'Writes an answer from verified claims only, citing each claim ID.' },
  { name: 'bad-liar', role: 'retriever', description: 'Research retriever.' }, // invents quotes: must fail the trial
  { name: 'bad-slow', role: 'retriever', description: 'Research retriever.' },  // never answers in time: must time out
];

export const agentUrl = name => `${CONFIG.AGENTS_BASE_URL}/agents/${name}`;
