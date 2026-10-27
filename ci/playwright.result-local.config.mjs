import config from './playwright.feedback-local.config.mjs';

export default { ...config, testMatch: 'result-layout.spec.mjs', timeout: 45000 };
