import { exec as execCallback, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { getConfigDir } from "./paths.js";
import { findPython3, isPythonVersionOk } from "./platform.js";

const exec = promisify(execCallback);

/** Directory for the managed MLX venv inside the config dir. */
export function getVenvDir() {
  return resolve(getConfigDir(), "mlx-venv");
}

/** Path to the python binary inside the managed venv. */
function getVenvPython() {
  return join(getVenvDir(), "bin", "python3");
}

/** Path to the PID file for the MLX server process. */
function getPidFile() {
  return resolve(getConfigDir(), "mlx-tts-server.pid");
}

/** Path to the bundled Python wrapper script. */
function getWrapperScript() {
  // Resolve relative to this file's location in the installed package
  return resolve(import.meta.dirname, "../../python/mlx_tts_server.py");
}

/**
 * Check if the MLX venv is set up with mlx-audio installed.
 * @returns {boolean}
 */
export function isVenvReady() {
  const venvPython = getVenvPython();
  return existsSync(venvPython);
}

/**
 * Set up the Python venv and install mlx-audio + dependencies.
 * @param {(msg: string) => void} log - Callback for progress messages.
 * @returns {Promise<void>}
 * @throws {Error} If Python3 cannot be found or installation fails.
 */
export async function setupVenv(log) {
  const python3 = await findPython3();
  if (!python3) {
    throw new Error(
      "Python 3 is required for MLX TTS but was not found.\n" +
        "Install it with: brew install python3",
    );
  }

  const versionOk = await isPythonVersionOk(python3);
  if (!versionOk) {
    throw new Error(
      `Python 3.10+ is required for MLX TTS, but ${python3} is older.\n` +
        "Upgrade with: brew install python@3.12",
    );
  }

  const venvDir = getVenvDir();

  // Create venv if it doesn't exist
  if (!existsSync(venvDir)) {
    log(`Creating Python venv at ${venvDir}...`);
    await mkdir(venvDir, { recursive: true });
    await exec(`"${python3}" -m venv "${venvDir}"`, { timeout: 30000 });
  }

  const pip = join(getVenvDir(), "bin", "pip");

  // Install/upgrade dependencies
  log("Installing mlx-audio and dependencies (this may take a few minutes on first run)...");
  await exec(
    `"${pip}" install --upgrade "mlx-audio[tts]" fastapi uvicorn soundfile`,
    { timeout: 600000 }, // 10 min — first install downloads ~500MB of MLX + models
  );
}

/**
 * Start the MLX TTS server (Python uvicorn process).
 * @param {number} port - Port to listen on.
 * @returns {Promise<number>} The PID of the spawned process.
 * @throws {Error} If the venv is not set up or the server fails to start.
 */
export async function startMlxServer(port) {
  if (!isVenvReady()) {
    throw new Error("MLX venv is not set up. Run setupVenv() first.");
  }

  const venvPython = getVenvPython();
  const wrapperScript = getWrapperScript();

  if (!existsSync(wrapperScript)) {
    throw new Error(`MLX wrapper script not found at ${wrapperScript}`);
  }

  // Spawn uvicorn as a detached background process
  const child = spawn(venvPython, [wrapperScript, String(port)], {
    cwd: "/",
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const pid = child.pid;

  // Save PID for later stop/status
  await writeFile(getPidFile(), String(pid), "utf-8");

  return pid;
}

/**
 * Stop the MLX TTS server by sending SIGTERM to the saved PID.
 * @returns {Promise<boolean>} True if the server was stopped, false if not running.
 */
export async function stopMlxServer() {
  const pidFile = getPidFile();

  if (!existsSync(pidFile)) {
    return false;
  }

  try {
    const pidStr = await readFile(pidFile, "utf-8");
    const pid = Number.parseInt(pidStr.trim(), 10);

    if (Number.isNaN(pid)) {
      await rm(pidFile, { force: true });
      return false;
    }

    // Check if process exists
    try {
      process.kill(pid, 0);
    } catch {
      // Process doesn't exist — clean up stale PID file
      await rm(pidFile, { force: true });
      return false;
    }

    // Send SIGTERM
    process.kill(pid, "SIGTERM");
    await rm(pidFile, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the MLX TTS server is currently running.
 * @returns {Promise<{running: boolean, pid: number|null}>}
 */
export async function getMlxServerStatus() {
  const pidFile = getPidFile();

  if (!existsSync(pidFile)) {
    return { running: false, pid: null };
  }

  try {
    const pidStr = await readFile(pidFile, "utf-8");
    const pid = Number.parseInt(pidStr.trim(), 10);

    if (Number.isNaN(pid)) {
      return { running: false, pid: null };
    }

    try {
      process.kill(pid, 0);
      return { running: true, pid };
    } catch (error) {
      if (error.code === "EPERM") {
        return { running: true, pid };
      }
      return { running: false, pid: null };
    }
  } catch {
    return { running: false, pid: null };
  }
}

/**
 * Remove the managed venv (for troubleshooting / reinstall).
 * @returns {Promise<boolean>} True if a venv was removed.
 */
export async function resetVenv() {
  const venvDir = getVenvDir();
  if (!existsSync(venvDir)) {
    return false;
  }
  await rm(venvDir, { recursive: true, force: true });
  return true;
}
