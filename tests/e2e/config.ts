/**
 * Ports and URLs for the E2E stack. These deliberately differ from Postloop's normal defaults (HTTP
 * 8025, SMTP 1025) so the suite never collides with a dev instance you have running, and they are all
 * env-overridable if a CI runner needs a different range.
 */
const num = (value: string | undefined, fallback: number): number => (value ? Number(value) : fallback);

export const POSTLOOP_HTTP_PORT = num(process.env.POSTLOOP_E2E_HTTP_PORT, 8130);
export const POSTLOOP_SMTP_PORT = num(process.env.POSTLOOP_E2E_SMTP_PORT, 1130);
export const DEMO_APP_PORT = num(process.env.POSTLOOP_E2E_DEMO_PORT, 4130);

export const POSTLOOP_URL = `http://127.0.0.1:${POSTLOOP_HTTP_PORT}`;
export const DEMO_APP_URL = `http://127.0.0.1:${DEMO_APP_PORT}`;
