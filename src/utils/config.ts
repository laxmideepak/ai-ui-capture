import dotenv from 'dotenv';

dotenv.config();

function getEnvNumber(key: string, fallback: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : fallback;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
}

export const config = {
  // Browser settings
  browser: {
    headless: getEnvBool('HEADLESS', false),
    slowMo: getEnvNumber('SLOW_MO', 800),
    timeout: getEnvNumber('TIMEOUT', 45000),
    viewport: {
      width: getEnvNumber('VIEWPORT_WIDTH', 1280),
      height: getEnvNumber('VIEWPORT_HEIGHT', 800),
    },
  },

  // OpenAI settings
  openai: {
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    maxTokens: getEnvNumber('MAX_TOKENS', 1500),
    temperature: 0,
  },

  // Agent settings
  agent: {
    maxSteps: getEnvNumber('MAX_STEPS', 20),
    retries: getEnvNumber('RETRIES', 2),
  },

  // Paths
  paths: {
    screenshots: process.env.SCREENSHOT_DIR || './output/screenshots',
    auth: './output/auth.json',
    dataset: './dataset',
  },

  // URLs
  urls: {
    linear: process.env.LINEAR_WORKSPACE_URL || 'https://linear.app',
    notion: process.env.NOTION_WORKSPACE_URL || 'https://notion.so',
    asana: process.env.ASANA_WORKSPACE_URL || 'https://app.asana.com',
  },

  // App-specific settings
  apps: {
    linear: {
      name: 'Linear',
      baseUrl: process.env.LINEAR_WORKSPACE_URL || 'https://linear.app',
      loginIndicators: ['sidebar', 'issues list', 'team name'],
    },
    notion: {
      name: 'Notion',
      baseUrl: process.env.NOTION_WORKSPACE_URL || 'https://notion.so',
      loginIndicators: ['workspace', 'sidebar', 'page list'],
    },
    asana: {
      name: 'Asana',
      baseUrl: process.env.ASANA_WORKSPACE_URL || 'https://app.asana.com',
      loginIndicators: ['sidebar', 'workspace', 'project list'],
    },
  },
};
