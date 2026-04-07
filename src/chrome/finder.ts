import { accessSync, constants } from "node:fs";

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ],
  linux: [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ],
};

/**
 * Find the system Chrome executable.
 * Checks CHROME_EXECUTABLE env var first, then platform-specific paths.
 * Throws a clear error if Chrome is not found.
 */
export function findChrome(): string {
  // Env override takes priority
  const envPath = process.env.CHROME_EXECUTABLE;
  if (envPath) {
    try {
      accessSync(envPath, constants.X_OK);
      return envPath;
    } catch {
      throw new Error(
        `CHROME_EXECUTABLE is set to "${envPath}" but the file is not found or not executable.`
      );
    }
  }

  const platform = process.platform;
  const candidates = CHROME_PATHS[platform];

  if (!candidates) {
    throw new Error(
      `Unsupported platform: ${platform}. Only macOS and Linux are supported. ` +
      `Set CHROME_EXECUTABLE to the path of your Chrome binary.`
    );
  }

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate
    }
  }

  throw new Error(
    `Chrome not found. Checked:\n${candidates.map(p => `  - ${p}`).join("\n")}\n\n` +
    `Install Google Chrome or set CHROME_EXECUTABLE to point to your Chrome binary.`
  );
}
