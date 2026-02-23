/**
 * Retrieves a required environment variable. Throws if it is missing or empty
 * so the middy error handler catches it and returns a 500 — no inline null
 * checks needed at call sites.
 */
export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
