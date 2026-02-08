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
 * Find a usable python3 binary path (3.10+).
 * Checks in order: Homebrew (versioned + unversioned), PATH, Xcode CLT, system.
 * Skips candidates older than 3.10.
 * @returns {Promise<string|null>} Path to python3 (3.10+) or null if not found.
 */
export async function findPython3() {
  const candidates = [];

  // 1. Versioned Homebrew paths (most likely to be 3.10+)
  const brewDirs = ["/opt/homebrew/bin", "/usr/local/bin"];
  const versionedNames = ["python3.13", "python3.12", "python3.11", "python3.10"];
  for (const dir of brewDirs) {
    for (const name of versionedNames) {
      const p = `${dir}/${name}`;
      if (existsSync(p)) candidates.push(p);
    }
    // Also check unversioned
    const unversioned = `${dir}/python3`;
    if (existsSync(unversioned)) candidates.push(unversioned);
  }

  // 2. PATH lookup
  try {
    const { stdout } = await exec("which python3", { timeout: 5000 });
    const path = stdout.trim();
    if (path && !candidates.includes(path)) candidates.push(path);
  } catch {
    // not in PATH
  }

  // 3. Xcode Command Line Tools
  try {
    const { stdout } = await exec("xcrun --find python3", { timeout: 5000 });
    const path = stdout.trim();
    if (path && !candidates.includes(path)) candidates.push(path);
  } catch {
    // not available
  }

  // 4. System Python (macOS ships python3 since Catalina)
  if (existsSync("/usr/bin/python3") && !candidates.includes("/usr/bin/python3")) {
    candidates.push("/usr/bin/python3");
  }

  // Return the first candidate that is 3.10+
  for (const candidate of candidates) {
    if (await isPythonVersionOk(candidate)) return candidate;
  }

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
