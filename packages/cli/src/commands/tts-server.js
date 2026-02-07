import chalk from "chalk";
import { loadConfig, saveConfig } from "../lib/config.js";
import {
  DEFAULTS,
  getContainerInfo,
  isContainerRunning,
  isDockerAvailable,
  pullImageIfNeeded,
  startContainer,
  stopContainer,
  waitForHealthCheck,
} from "../lib/docker.js";
import {
  getMlxServerStatus,
  isVenvReady,
  setupVenv,
  startMlxServer,
  stopMlxServer,
} from "../lib/mlx.js";
import { isAppleSilicon } from "../lib/platform.js";

/**
 * Validate a port number is within the valid TCP range.
 * @param {number} port
 * @throws {Error} If port is not a valid integer in range 1-65535.
 */
export function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${port}. Must be an integer between 1 and 65535.`);
  }
}

/**
 * Validate a Docker container name.
 * Docker requires: [a-zA-Z0-9][a-zA-Z0-9_.-]* and max 64 chars.
 * @param {string} name
 * @throws {Error} If name is not a valid Docker container name.
 */
export function validateContainerName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 64) {
    throw new Error(`Invalid container name: "${name}". Must be 1-64 characters.`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(
      `Invalid container name: "${name}". Must start with alphanumeric and contain only [a-zA-Z0-9_.-].`,
    );
  }
}

/**
 * Detect which backend to use based on platform.
 * @returns {"mlx" | "docker"}
 */
function detectBackend() {
  return isAppleSilicon() ? "mlx" : "docker";
}

/**
 * Get the TTS server configuration from the config file.
 * Returns merged defaults with any user overrides. Validates port and container name.
 * @returns {Promise<{containerName: string, port: number, image: string}>}
 */
async function getTtsConfig() {
  const config = await loadConfig();
  const tts = config.ttsServer || {};
  const containerName = tts.containerName || DEFAULTS.containerName;
  const port = tts.port || DEFAULTS.port;
  const image = tts.image || DEFAULTS.image;

  validatePort(port);
  validateContainerName(containerName);

  return { containerName, port, image };
}

/**
 * Save TTS server configuration to the config file.
 * Preserves existing config fields (servers, etc).
 * @param {{containerName: string, port: number, image: string}} ttsConfig
 */
async function saveTtsConfig(ttsConfig) {
  const config = await loadConfig();
  config.ttsServer = ttsConfig;
  await saveConfig(config);
}

/**
 * `msv tts-server start` — Start the Kokoro TTS server.
 * Auto-detects Apple Silicon and uses native MLX backend, otherwise Docker.
 */
export async function startTtsServer() {
  try {
    const ttsConfig = await getTtsConfig();
    const { port } = ttsConfig;
    const backend = detectBackend();

    if (backend === "mlx") {
      await startTtsServerMlx(port);
    } else {
      await startTtsServerDocker(ttsConfig);
    }
  } catch (error) {
    console.error(chalk.red(`Unexpected error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Start the TTS server using the native MLX backend on Apple Silicon.
 * @param {number} port - Port to listen on.
 */
async function startTtsServerMlx(port) {
  console.log(chalk.cyan("Apple Silicon detected — using native MLX backend."));

  // Check if already running
  const status = await getMlxServerStatus();
  if (status.running) {
    console.log(chalk.yellow(`TTS server is already running (PID: ${status.pid})`));
    console.log(chalk.cyan(`  URL: http://localhost:${port}`));
    return;
  }

  // Auto-setup venv if needed
  if (!isVenvReady()) {
    console.log(chalk.cyan("First-time setup: installing MLX-Audio..."));
    await setupVenv((msg) => console.log(chalk.gray(`  ${msg}`)));
    console.log(chalk.green("MLX-Audio installed successfully."));
  }

  // Start server
  console.log(chalk.cyan(`Starting MLX TTS server on port ${port}...`));
  const pid = await startMlxServer(port);

  // Health check
  const healthUrl = `http://localhost:${port}/health`;
  console.log(chalk.cyan("Waiting for server to be ready..."));
  const healthy = await waitForHealthCheck(healthUrl, 120000);
  if (!healthy) {
    console.error(chalk.red("Error: MLX TTS server failed to become healthy within 2 minutes."));
    console.error(chalk.gray("Check if mlx-audio is installed correctly."));
    process.exit(1);
  }

  console.log(chalk.green("TTS server is running! (MLX native)"));
  console.log(chalk.white(`  PID: ${pid}`));
  console.log(chalk.white(`  URL: ${chalk.cyan(`http://localhost:${port}`)}`));
}

/**
 * Start the TTS server using the Docker backend.
 * @param {{containerName: string, port: number, image: string}} ttsConfig
 */
async function startTtsServerDocker(ttsConfig) {
  const { containerName, port, image } = ttsConfig;

  // Step 1: Check Docker availability
  console.log(chalk.cyan("Checking Docker..."));
  const dockerReady = await isDockerAvailable();
  if (!dockerReady) {
    console.error(chalk.red("Error: Docker is not available."));
    console.error(chalk.red("Please install Docker Desktop and ensure the daemon is running."));
    console.error(chalk.gray("  https://www.docker.com/products/docker-desktop"));
    process.exit(1);
  }

  // Step 2: Check if already running
  const alreadyRunning = await isContainerRunning(containerName);
  if (alreadyRunning) {
    console.log(chalk.yellow(`TTS server is already running (container: ${containerName})`));
    console.log(chalk.cyan(`  URL: http://localhost:${port}`));
    return;
  }

  // Step 3: Pull image if needed
  console.log(chalk.cyan(`Pulling image ${image} (this may take a while on first run)...`));
  const pulled = await pullImageIfNeeded(image);
  if (!pulled) {
    console.error(chalk.red(`Error: Failed to pull Docker image: ${image}`));
    console.error(chalk.red("Check your internet connection and try again."));
    process.exit(1);
  }
  console.log(chalk.green("Image ready."));

  // Step 4: Start container
  console.log(chalk.cyan(`Starting TTS server on port ${port}...`));
  let containerId;
  try {
    containerId = await startContainer(containerName, image, port);
  } catch (error) {
    console.error(chalk.red(`Error starting container: ${error.message}`));
    console.error(chalk.gray(`Is port ${port} already in use? Try: lsof -i :${port}`));
    process.exit(1);
  }

  // Step 5: Health check
  const healthUrl = `http://localhost:${port}/v1/models`;
  console.log(chalk.cyan(`Waiting for server to be ready (checking ${healthUrl})...`));
  const healthy = await waitForHealthCheck(healthUrl, 120000); // 2 min for model loading
  if (!healthy) {
    console.error(chalk.red("Error: TTS server failed to become healthy within 2 minutes."));
    console.error(chalk.gray(`Check container logs: docker logs ${containerName}`));
    // Don't stop the container — it might just need more time for model download
    process.exit(1);
  }

  // Step 6: Save config
  await saveTtsConfig(ttsConfig);

  console.log(chalk.green("TTS server is running!"));
  console.log(chalk.white(`  Container: ${containerName} (${containerId})`));
  console.log(chalk.white(`  URL: ${chalk.cyan(`http://localhost:${port}`)}`));
  console.log(chalk.white(`  Health: ${chalk.cyan(healthUrl)}`));
}

/**
 * `msv tts-server stop` — Stop the Kokoro TTS server.
 */
export async function stopTtsServer() {
  try {
    const ttsConfig = await getTtsConfig();
    const backend = detectBackend();

    if (backend === "mlx") {
      const stopped = await stopMlxServer();
      if (stopped) {
        console.log(chalk.green("TTS server stopped. (MLX native)"));
      } else {
        console.log(chalk.yellow("TTS server was not running."));
      }
    } else {
      const { containerName } = ttsConfig;
      console.log(chalk.cyan(`Stopping TTS server (container: ${containerName})...`));
      const stopped = await stopContainer(containerName);
      if (stopped) {
        console.log(chalk.green("TTS server stopped and container removed."));
      } else {
        console.log(chalk.yellow("TTS server was not running."));
      }
    }
  } catch (error) {
    console.error(chalk.red(`Error stopping TTS server: ${error.message}`));
    process.exit(1);
  }
}

/**
 * `msv tts-server status` — Check the status of the Kokoro TTS server.
 */
export async function statusTtsServer() {
  try {
    const ttsConfig = await getTtsConfig();
    const { port } = ttsConfig;
    const backend = detectBackend();

    if (backend === "mlx") {
      const status = await getMlxServerStatus();
      if (status.running) {
        console.log(chalk.green("TTS server is running. (MLX native)"));
        console.log(chalk.white(`  PID: ${status.pid}`));
      } else {
        console.log(chalk.yellow("TTS server is not running."));
        console.log(chalk.gray("  To start: msv tts-server start"));
      }
      console.log(chalk.white("  Backend: MLX (Apple Silicon)"));
      console.log(chalk.white(`  URL: http://localhost:${port}`));
    } else {
      const { containerName } = ttsConfig;

      // Check Docker first
      const dockerReady = await isDockerAvailable();
      if (!dockerReady) {
        console.log(chalk.red("Docker is not available."));
        return;
      }

      // Get container info
      const info = await getContainerInfo(containerName);

      if (!info) {
        console.log(chalk.yellow("TTS server is not running."));
        console.log(chalk.gray("  To start: msv tts-server start"));
        return;
      }

      if (info.running) {
        console.log(chalk.green("TTS server is running."));
      } else {
        console.log(chalk.yellow(`TTS server container exists but is ${info.status}.`));
        console.log(chalk.gray("  To start: msv tts-server start"));
      }

      console.log(chalk.white(`  Container: ${containerName} (${info.id})`));
      console.log(chalk.white(`  Image: ${info.image}`));
      console.log(chalk.white(`  Status: ${info.status}`));
      console.log(chalk.white(`  URL: http://localhost:${port}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error checking TTS server status: ${error.message}`));
    process.exit(1);
  }
}
