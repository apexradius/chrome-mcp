import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_PROFILE_DIR = join(
  homedir(),
  ".config",
  "apexradius",
  "chrome-mcp",
  "profile"
);

/**
 * Get the Chrome profile directory path.
 * Uses CHROME_PROFILE_DIR env var or defaults to ~/.config/apexradius/chrome-mcp/profile
 */
export function getProfileDir(): string {
  return process.env.CHROME_PROFILE_DIR || DEFAULT_PROFILE_DIR;
}

/**
 * Ensure the profile directory exists, creating it recursively if needed.
 * Returns the profile directory path.
 */
export function ensureProfileDir(): string {
  const dir = getProfileDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
