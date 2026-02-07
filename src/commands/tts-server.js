import chalk from 'chalk';
import { loadConfig, saveConfig } from '../lib/config.js';
import {
  isDockerAvailable,
  isContainerRunning,
  getContainerInfo,
  pullImageIfNeeded,
  startContainer,
  stopContainer,
  waitForHealthCheck,
  DEFAULTS,
} from '../lib/docker.js';

/**
 * Get the TTS server configuration from the config file.
 * Returns merged defaults with any user overrides.
 * @returns {Promise<{containerName: string, port: number, image: string}>}
 */
async function getTtsConfig() {
  const config = await loadConfig();
  const tts = config.ttsServer || {};
  return {
    containerName: tts.containerName || DEFAULTS.containerName,
    port: tts.port || DEFAULTS.port,
    image: tts.image || DEFAULTS.image,
  };
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
 * `msv tts-server start` — Start the Kokoro TTS Docker container.
 *
 * Flow:
 * 1. Check that Docker is available and daemon is running
 * 2. Check if container is already running
 * 3. Pull the image if not available locally
 * 4. Start the container with port mapping
 * 5. Wait for the health check endpoint to respond
 * 6. Save config
 */
export async function startTtsServer() {
  try {
    const ttsConfig = await getTtsConfig();
    const { containerName, port, image } = ttsConfig;

    // Step 1: Check Docker availability
    console.log(chalk.cyan('Checking Docker...'));
    const dockerReady = await isDockerAvailable();
    if (!dockerReady) {
      console.error(chalk.red('Error: Docker is not available.'));
      console.error(chalk.red('Please install Docker Desktop and ensure the daemon is running.'));
      console.error(chalk.gray('  https://www.docker.com/products/docker-desktop'));
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
      console.error(chalk.red('Check your internet connection and try again.'));
      process.exit(1);
    }
    console.log(chalk.green('Image ready.'));

    // Step 4: Start container
    console.log(chalk.cyan(`Starting TTS server on port ${port}...`));
    let containerId;
    try {
      containerId = await startContainer(containerName, image, port);
    } catch (error) {
      console.error(chalk.red(`Error starting container: ${error.message}`));
      console.error(chalk.gray('Is port ' + port + ' already in use? Try: lsof -i :' + port));
      process.exit(1);
    }

    // Step 5: Health check
    const healthUrl = `http://localhost:${port}/v1/models`;
    console.log(chalk.cyan(`Waiting for server to be ready (checking ${healthUrl})...`));
    const healthy = await waitForHealthCheck(healthUrl, 120000); // 2 min for model loading
    if (!healthy) {
      console.error(chalk.red('Error: TTS server failed to become healthy within 2 minutes.'));
      console.error(chalk.gray('Check container logs: docker logs ' + containerName));
      // Don't stop the container — it might just need more time for model download
      process.exit(1);
    }

    // Step 6: Save config
    await saveTtsConfig(ttsConfig);

    console.log(chalk.green(`TTS server is running!`));
    console.log(chalk.white(`  Container: ${containerName} (${containerId})`));
    console.log(chalk.white(`  URL: ${chalk.cyan(`http://localhost:${port}`)}`));
    console.log(chalk.white(`  Health: ${chalk.cyan(healthUrl)}`));
  } catch (error) {
    console.error(chalk.red(`Unexpected error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * `msv tts-server stop` — Stop and remove the Kokoro TTS Docker container.
 */
export async function stopTtsServer() {
  try {
    const ttsConfig = await getTtsConfig();
    const { containerName } = ttsConfig;

    console.log(chalk.cyan(`Stopping TTS server (container: ${containerName})...`));

    const stopped = await stopContainer(containerName);

    if (stopped) {
      console.log(chalk.green('TTS server stopped and container removed.'));
    } else {
      console.log(chalk.yellow('TTS server was not running.'));
    }
  } catch (error) {
    console.error(chalk.red(`Error stopping TTS server: ${error.message}`));
    process.exit(1);
  }
}

/**
 * `msv tts-server status` — Check the status of the Kokoro TTS Docker container.
 */
export async function statusTtsServer() {
  try {
    const ttsConfig = await getTtsConfig();
    const { containerName, port, image } = ttsConfig;

    // Check Docker first
    const dockerReady = await isDockerAvailable();
    if (!dockerReady) {
      console.log(chalk.red('Docker is not available.'));
      return;
    }

    // Get container info
    const info = await getContainerInfo(containerName);

    if (!info) {
      console.log(chalk.yellow('TTS server is not running.'));
      console.log(chalk.gray(`  To start: msv tts-server start`));
      return;
    }

    if (info.running) {
      console.log(chalk.green('TTS server is running.'));
    } else {
      console.log(chalk.yellow(`TTS server container exists but is ${info.status}.`));
      console.log(chalk.gray(`  To start: msv tts-server start`));
    }

    console.log(chalk.white(`  Container: ${containerName} (${info.id})`));
    console.log(chalk.white(`  Image: ${info.image}`));
    console.log(chalk.white(`  Status: ${info.status}`));
    console.log(chalk.white(`  URL: http://localhost:${port}`));
  } catch (error) {
    console.error(chalk.red(`Error checking TTS server status: ${error.message}`));
    process.exit(1);
  }
}
