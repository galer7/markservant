import { exec as execCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execCallback);

/**
 * Check if running on Apple Silicon (macOS ARM64).
 * @returns {boolean}
 */
export function isAppleSilicon() {
  return platform() === "darwin" && arch() === "arm64";
}

/**
 * Find a usable python3 binary path.
 * Checks in order: PATH, Homebrew, Xcode Command Line Tools, system.
 * @returns {Promise<string|null>} Path to python3 or null if not found.
 */
export async function findPython3() {
  // 1. Check PATH
  try {
    const { stdout } = await exec("which python3", { timeout: 5000 });
    const path = stdout.trim();
    if (path) return path;
  } catch {
    // not in PATH
  }

  // 2. Common Homebrew locations
  const brewPaths = [
    "/opt/homebrew/bin/python3", // Apple Silicon Homebrew
    "/usr/local/bin/python3", // Intel Homebrew
  ];
  for (const p of brewPaths) {
    if (existsSync(p)) return p;
  }

  // 3. Xcode Command Line Tools
  try {
    const { stdout } = await exec("xcrun --find python3", { timeout: 5000 });
    const path = stdout.trim();
    if (path) return path;
  } catch {
    // not available
  }

  // 4. System Python (macOS ships python3 since Catalina)
  if (existsSync("/usr/bin/python3")) return "/usr/bin/python3";

  return null;
}

/**
 * Validate that a python3 binary is version 3.10+.
 * MLX requires Python 3.10 or later.
 * @param {string} pythonPath - Path to python3 binary.
 * @returns {Promise<boolean>}
 */
export async function isPythonVersionOk(pythonPath) {
  try {
    const { stdout } = await exec(
      `"${pythonPath}" -c "import sys; print(sys.version_info.major, sys.version_info.minor)"`,
      { timeout: 5000 },
    );
    const [major, minor] = stdout.trim().split(" ").map(Number);
    return major === 3 && minor >= 10;
  } catch {
    return false;
  }
}
