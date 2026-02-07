import { exec as execCallback } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execSync: vi.fn(),
}));

// Import after mocking
const {
  isDockerAvailable,
  isContainerRunning,
  getContainerInfo,
  pullImageIfNeeded,
  startContainer,
  stopContainer,
  waitForHealthCheck,
  DEFAULTS,
} = await import("./docker.js");

/**
 * Helper to make the mocked exec resolve successfully.
 * @param {string} stdout - The stdout value to resolve with.
 */
function mockExecSuccess(stdout = "") {
  execCallback.mockImplementation((_cmd, opts, callback) => {
    // Handle 2-arg form (cmd, callback) vs 3-arg form (cmd, opts, callback)
    const cb = typeof opts === "function" ? opts : callback;
    cb(null, { stdout, stderr: "" });
  });
}

/**
 * Helper to make the mocked exec reject with an error.
 * @param {string} message - The error message.
 */
function mockExecFailure(message = "command failed") {
  execCallback.mockImplementation((_cmd, opts, callback) => {
    const cb = typeof opts === "function" ? opts : callback;
    cb(new Error(message), { stdout: "", stderr: message });
  });
}

/**
 * Helper to make the mocked exec respond differently based on command.
 * @param {Object} mapping - An object mapping command substrings to { stdout, err } values.
 */
function mockExecByCommand(mapping) {
  execCallback.mockImplementation((cmd, opts, callback) => {
    const cb = typeof opts === "function" ? opts : callback;
    for (const [key, value] of Object.entries(mapping)) {
      if (cmd.includes(key)) {
        if (value.err) {
          cb(new Error(value.err), { stdout: "", stderr: value.err });
        } else {
          cb(null, { stdout: value.stdout || "", stderr: "" });
        }
        return;
      }
    }
    // Default: fail
    cb(new Error(`unmocked command: ${cmd}`), { stdout: "", stderr: "" });
  });
}

describe("docker.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DEFAULTS", () => {
    it("has correct container name", () => {
      expect(DEFAULTS.containerName).toBe("markservant-kokoro-tts");
    });

    it("has correct image", () => {
      expect(DEFAULTS.image).toBe("ghcr.io/remsky/kokoro-fastapi-cpu:latest");
    });

    it("has correct port", () => {
      expect(DEFAULTS.port).toBe(8880);
    });
  });

  describe("isDockerAvailable", () => {
    it("returns true when docker info succeeds", async () => {
      mockExecSuccess("Docker version info...");

      const result = await isDockerAvailable();

      expect(result).toBe(true);
      expect(execCallback).toHaveBeenCalledWith(
        "docker info",
        expect.objectContaining({ timeout: 10000 }),
        expect.any(Function),
      );
    });

    it("returns false when docker info fails (Docker not installed)", async () => {
      mockExecFailure("command not found: docker");

      const result = await isDockerAvailable();

      expect(result).toBe(false);
    });

    it("returns false when Docker daemon is not running", async () => {
      mockExecFailure("Cannot connect to the Docker daemon");

      const result = await isDockerAvailable();

      expect(result).toBe(false);
    });
  });

  describe("isContainerRunning", () => {
    it("returns true when container is running", async () => {
      mockExecSuccess("true");

      const result = await isContainerRunning("my-container");

      expect(result).toBe(true);
      expect(execCallback).toHaveBeenCalledWith(
        expect.stringContaining("docker inspect"),
        expect.any(Object),
        expect.any(Function),
      );
      expect(execCallback).toHaveBeenCalledWith(
        expect.stringContaining("my-container"),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("returns false when container is stopped", async () => {
      mockExecSuccess("false");

      const result = await isContainerRunning("stopped-container");

      expect(result).toBe(false);
    });

    it("returns false when container does not exist", async () => {
      mockExecFailure("No such container");

      const result = await isContainerRunning("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("getContainerInfo", () => {
    it("returns container info when container exists and is running", async () => {
      mockExecSuccess("true|running|ghcr.io/remsky/kokoro-fastapi-cpu:latest|abc123def456789");

      const info = await getContainerInfo("my-container");

      expect(info).toEqual({
        running: true,
        status: "running",
        image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
        id: "abc123def456",
      });
    });

    it("returns container info when container is stopped", async () => {
      mockExecSuccess("false|exited|ghcr.io/remsky/kokoro-fastapi-cpu:latest|def456abc789012");

      const info = await getContainerInfo("stopped");

      expect(info).toEqual({
        running: false,
        status: "exited",
        image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
        id: "def456abc789",
      });
    });

    it("returns null when container does not exist", async () => {
      mockExecFailure("No such container");

      const info = await getContainerInfo("nonexistent");

      expect(info).toBeNull();
    });
  });

  describe("pullImageIfNeeded", () => {
    it("returns true without pulling when image already exists", async () => {
      // docker image inspect succeeds — image exists locally
      mockExecSuccess("Image details...");

      const result = await pullImageIfNeeded("my-image:latest");

      expect(result).toBe(true);
      // Should have called inspect, but not pull
      expect(execCallback).toHaveBeenCalledTimes(1);
      expect(execCallback).toHaveBeenCalledWith(
        "docker image inspect my-image:latest",
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("pulls image and returns true when image does not exist locally", async () => {
      mockExecByCommand({
        "docker image inspect": { err: "No such image" },
        "docker pull": { stdout: "Pull complete" },
      });

      const result = await pullImageIfNeeded("my-image:latest");

      expect(result).toBe(true);
      expect(execCallback).toHaveBeenCalledTimes(2);
    });

    it("returns false when pull fails", async () => {
      mockExecByCommand({
        "docker image inspect": { err: "No such image" },
        "docker pull": { err: "Network error" },
      });

      const result = await pullImageIfNeeded("my-image:latest");

      expect(result).toBe(false);
    });
  });

  describe("startContainer", () => {
    it("starts a container and returns the container ID", async () => {
      mockExecByCommand({
        "docker rm -f": { stdout: "" }, // cleanup of existing container
        "docker run": { stdout: "abc123def456789abcdef0123456789abcdef01234567890abcdef\n" },
      });

      const id = await startContainer("my-container", "my-image:latest", 8880);

      expect(id).toBe("abc123def456");
    });

    it("runs container with correct port mapping", async () => {
      mockExecByCommand({
        "docker rm -f": { stdout: "" },
        "docker run": { stdout: "container_id_12\n" },
      });

      await startContainer("test-container", "test-image:latest", 9999);

      // Find the docker run call
      const runCall = execCallback.mock.calls.find((c) => c[0].includes("docker run"));
      expect(runCall).toBeDefined();
      expect(runCall[0]).toContain("-p 9999:8880");
      expect(runCall[0]).toContain("--name test-container");
      expect(runCall[0]).toContain("test-image:latest");
      expect(runCall[0]).toContain("-d");
    });

    it("removes existing container before starting", async () => {
      const callOrder = [];
      execCallback.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === "function" ? opts : callback;
        if (cmd.includes("docker rm -f")) {
          callOrder.push("rm");
          cb(null, { stdout: "", stderr: "" });
        } else if (cmd.includes("docker run")) {
          callOrder.push("run");
          cb(null, { stdout: "newcontainer123\n", stderr: "" });
        } else {
          cb(new Error(`unmocked: ${cmd}`), { stdout: "", stderr: "" });
        }
      });

      await startContainer("my-container", "my-image", 8880);

      expect(callOrder).toEqual(["rm", "run"]);
    });

    it("starts even if rm fails (no existing container)", async () => {
      mockExecByCommand({
        "docker rm -f": { err: "No such container" },
        "docker run": { stdout: "newcontainer123\n" },
      });

      const id = await startContainer("new-container", "my-image", 8880);

      expect(id).toBe("newcontainer");
    });

    it("throws when docker run fails", async () => {
      mockExecByCommand({
        "docker rm -f": { stdout: "" },
        "docker run": { err: "Port already in use" },
      });

      await expect(startContainer("fail-container", "my-image", 8880)).rejects.toThrow(
        "Port already in use",
      );
    });
  });

  describe("stopContainer", () => {
    it("returns true when container is stopped and removed", async () => {
      mockExecByCommand({
        "docker stop": { stdout: "container-name\n" },
        "docker rm": { stdout: "container-name\n" },
      });

      const result = await stopContainer("my-container");

      expect(result).toBe(true);
    });

    it("returns true when stop succeeds but rm fails (auto-removed)", async () => {
      mockExecByCommand({
        "docker stop": { stdout: "container-name\n" },
        "docker rm": { err: "No such container" },
      });

      const result = await stopContainer("my-container");

      expect(result).toBe(true);
    });

    it("returns false when container does not exist", async () => {
      mockExecFailure("No such container");

      const result = await stopContainer("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("waitForHealthCheck", () => {
    it("returns true when health check succeeds immediately", async () => {
      mockExecSuccess("200");

      const result = await waitForHealthCheck("http://localhost:8880/v1/models", 5000);

      expect(result).toBe(true);
    });

    it("returns true after retrying when health check initially fails", async () => {
      let callCount = 0;
      execCallback.mockImplementation((_cmd, opts, callback) => {
        const cb = typeof opts === "function" ? opts : callback;
        callCount++;
        if (callCount <= 2) {
          cb(new Error("Connection refused"), { stdout: "", stderr: "" });
        } else {
          cb(null, { stdout: "200", stderr: "" });
        }
      });

      const result = await waitForHealthCheck("http://localhost:8880/v1/models", 30000);

      expect(result).toBe(true);
      expect(callCount).toBe(3);
    });

    it("returns false when health check never succeeds within timeout", async () => {
      mockExecFailure("Connection refused");

      // Use a very short timeout to make the test fast
      const result = await waitForHealthCheck("http://localhost:8880/v1/models", 2000);

      expect(result).toBe(false);
    });

    it("returns false when server returns non-200 status", async () => {
      mockExecSuccess("503");

      // Short timeout — will retry but always get 503
      const result = await waitForHealthCheck("http://localhost:8880/v1/models", 2000);

      expect(result).toBe(false);
    });

    it("calls curl with the correct URL", async () => {
      mockExecSuccess("200");

      await waitForHealthCheck("http://localhost:8880/v1/models", 5000);

      expect(execCallback).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:8880/v1/models"),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
