import { exec as execCallback, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

/**
 * Default container configuration for the Kokoro TTS server.
 */
export const DEFAULTS = {
  containerName: 'markservant-kokoro-tts',
  image: 'ghcr.io/remsky/kokoro-fastapi-cpu:latest',
  port: 8880,
};

/**
 * Check if Docker is available on the system by running `docker info`.
 * @returns {Promise<boolean>} True if Docker is available and the daemon is running.
 */
export async function isDockerAvailable() {
  try {
    await exec('docker info', { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Docker container with the given name is currently running.
 * Uses `docker inspect` to check the container's running state.
 * @param {string} name - The container name to check.
 * @returns {Promise<boolean>} True if the container exists and is running.
 */
export async function isContainerRunning(name) {
  try {
    const { stdout } = await exec(
      `docker inspect --format='{{.State.Running}}' ${name}`,
      { timeout: 10000 }
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Get detailed status information about a Docker container.
 * @param {string} name - The container name to inspect.
 * @returns {Promise<{running: boolean, status: string, image: string, ports: string}|null>}
 *   Container info object, or null if the container doesn't exist.
 */
export async function getContainerInfo(name) {
  try {
    const { stdout } = await exec(
      `docker inspect --format='{{.State.Running}}|{{.State.Status}}|{{.Config.Image}}|{{.Id}}' ${name}`,
      { timeout: 10000 }
    );
    const parts = stdout.trim().split('|');
    return {
      running: parts[0] === 'true',
      status: parts[1],
      image: parts[2],
      id: parts[3] ? parts[3].substring(0, 12) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Pull a Docker image if it is not already available locally.
 * @param {string} image - The full image reference (e.g. 'ghcr.io/remsky/kokoro-fastapi-cpu:latest').
 * @returns {Promise<boolean>} True if the image was pulled (or already present), false on failure.
 */
export async function pullImageIfNeeded(image) {
  try {
    // Check if image already exists locally
    await exec(`docker image inspect ${image}`, { timeout: 10000 });
    return true;
  } catch {
    // Image not found locally, pull it
    try {
      await exec(`docker pull ${image}`, { timeout: 600000 }); // 10 min timeout for large images
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Start a Docker container in detached mode with the given configuration.
 * @param {string} name - The container name.
 * @param {string} image - The Docker image to run.
 * @param {number} port - The host port to map to container port 8880.
 * @returns {Promise<string>} The container ID (short form).
 * @throws {Error} If the container fails to start.
 */
export async function startContainer(name, image, port) {
  // Remove any existing stopped container with the same name
  try {
    await exec(`docker rm -f ${name}`, { timeout: 10000 });
  } catch {
    // Ignore — container may not exist
  }

  const { stdout } = await exec(
    `docker run -d --name ${name} -p ${port}:8880 ${image}`,
    { timeout: 60000 }
  );

  return stdout.trim().substring(0, 12);
}

/**
 * Stop and remove a Docker container.
 * @param {string} name - The container name to stop and remove.
 * @returns {Promise<boolean>} True if the container was stopped, false if it wasn't running.
 */
export async function stopContainer(name) {
  try {
    await exec(`docker stop ${name}`, { timeout: 30000 });
    // Remove the container after stopping
    try {
      await exec(`docker rm ${name}`, { timeout: 10000 });
    } catch {
      // Container may have been auto-removed
    }
    return true;
  } catch {
    // Try to remove in case it's stopped but not removed
    try {
      await exec(`docker rm ${name}`, { timeout: 10000 });
    } catch {
      // Container doesn't exist at all
    }
    return false;
  }
}

/**
 * Wait for a health check endpoint to respond with HTTP 200.
 * Retries with exponential backoff up to the given timeout.
 * @param {string} url - The URL to check.
 * @param {number} [timeoutMs=60000] - Maximum time to wait in milliseconds.
 * @returns {Promise<boolean>} True if the health check succeeded within the timeout.
 */
export async function waitForHealthCheck(url, timeoutMs = 60000) {
  const startTime = Date.now();
  let delay = 1000; // Start with 1s delay

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { stdout } = await exec(
        `curl -sf -o /dev/null -w '%{http_code}' ${url}`,
        { timeout: 5000 }
      );
      if (stdout.trim() === '200') {
        return true;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 5000); // Cap at 5s
  }

  return false;
}
