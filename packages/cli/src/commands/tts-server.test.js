import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock paths module (same pattern as config.test.js)
vi.mock("../lib/paths.js", async () => {
  return {
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, "config.json"),
    normalizePath: (dir) => dir || "/normalized/path",
  };
});

// Mock the docker module — we don't want real Docker calls in tests
vi.mock("../lib/docker.js", async () => {
  const actual = await vi.importActual("../lib/docker.js");
  return {
    DEFAULTS: actual.DEFAULTS,
    isDockerAvailable: vi.fn(),
    isContainerRunning: vi.fn(),
    getContainerInfo: vi.fn(),
    pullImageIfNeeded: vi.fn(),
    startContainer: vi.fn(),
    stopContainer: vi.fn(),
    waitForHealthCheck: vi.fn(),
  };
});

// Import mocked docker functions
const docker = await import("../lib/docker.js");

// Import commands after mocking
const { startTtsServer, stopTtsServer, statusTtsServer } = await import("./tts-server.js");

describe("tts-server.js", () => {
  let testConfigDir;
  let mockConsoleLog;
  let mockConsoleError;
  let mockProcessExit;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(
      tmpdir(),
      `markservant-tts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    await mkdir(testConfigDir, { recursive: true });

    // Mock console and process.exit
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    vi.clearAllMocks();
    // Re-apply spies after clearAllMocks
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(async () => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();

    if (existsSync(testConfigDir)) {
      await rm(testConfigDir, { recursive: true, force: true });
    }
    delete globalThis.__TEST_CONFIG_DIR__;
  });

  describe("startTtsServer", () => {
    it("exits with error when Docker is not available", async () => {
      docker.isDockerAvailable.mockResolvedValue(false);

      await expect(startTtsServer()).rejects.toThrow("process.exit called");

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Docker is not available"),
      );
    });

    it("reports already running and returns early if container is running", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.isContainerRunning.mockResolvedValue(true);

      await startTtsServer();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("already running"));
      // Should not have called startContainer
      expect(docker.startContainer).not.toHaveBeenCalled();
    });

    it("exits with error when image pull fails", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.isContainerRunning.mockResolvedValue(false);
      docker.pullImageIfNeeded.mockResolvedValue(false);

      await expect(startTtsServer()).rejects.toThrow("process.exit called");

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to pull Docker image"),
      );
    });

    it("exits with error when container fails to start", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.isContainerRunning.mockResolvedValue(false);
      docker.pullImageIfNeeded.mockResolvedValue(true);
      docker.startContainer.mockRejectedValue(new Error("Port in use"));

      await expect(startTtsServer()).rejects.toThrow("process.exit called");

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining("Port in use"));
    });

    it("exits with error when health check fails", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.isContainerRunning.mockResolvedValue(false);
      docker.pullImageIfNeeded.mockResolvedValue(true);
      docker.startContainer.mockResolvedValue("abc123def456");
      docker.waitForHealthCheck.mockResolvedValue(false);

      await expect(startTtsServer()).rejects.toThrow("process.exit called");

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("failed to become healthy"),
      );
    });

    it("starts container successfully and saves config", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.isContainerRunning.mockResolvedValue(false);
      docker.pullImageIfNeeded.mockResolvedValue(true);
      docker.startContainer.mockResolvedValue("abc123def456");
      docker.waitForHealthCheck.mockResolvedValue(true);

      await startTtsServer();

      // Verify docker calls were made in order
      expect(docker.isDockerAvailable).toHaveBeenCalled();
      expect(docker.isContainerRunning).toHaveBeenCalledWith("markservant-kokoro-tts");
      expect(docker.pullImageIfNeeded).toHaveBeenCalledWith(
        "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
      );
      expect(docker.startContainer).toHaveBeenCalledWith(
        "markservant-kokoro-tts",
        "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
        8880,
      );
      expect(docker.waitForHealthCheck).toHaveBeenCalledWith(
        "http://localhost:8880/v1/models",
        120000,
      );

      // Verify success message
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("TTS server is running"));

      // Verify config was saved
      const configPath = join(testConfigDir, "config.json");
      const content = await readFile(configPath, "utf-8");
      const config = JSON.parse(content);
      expect(config.ttsServer).toEqual({
        containerName: "markservant-kokoro-tts",
        port: 8880,
        image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
      });
    });

    it("uses custom config values from config file", async () => {
      // Write a config with custom TTS settings
      const configPath = join(testConfigDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          servers: [],
          ttsServer: {
            containerName: "custom-tts",
            port: 9999,
            image: "custom-image:v2",
          },
        }),
        "utf-8",
      );

      docker.isDockerAvailable.mockResolvedValue(true);
      docker.isContainerRunning.mockResolvedValue(false);
      docker.pullImageIfNeeded.mockResolvedValue(true);
      docker.startContainer.mockResolvedValue("xyz789");
      docker.waitForHealthCheck.mockResolvedValue(true);

      await startTtsServer();

      expect(docker.isContainerRunning).toHaveBeenCalledWith("custom-tts");
      expect(docker.pullImageIfNeeded).toHaveBeenCalledWith("custom-image:v2");
      expect(docker.startContainer).toHaveBeenCalledWith("custom-tts", "custom-image:v2", 9999);
      expect(docker.waitForHealthCheck).toHaveBeenCalledWith(
        "http://localhost:9999/v1/models",
        120000,
      );
    });
  });

  describe("stopTtsServer", () => {
    it("stops running container and reports success", async () => {
      docker.stopContainer.mockResolvedValue(true);

      await stopTtsServer();

      expect(docker.stopContainer).toHaveBeenCalledWith("markservant-kokoro-tts");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("stopped and container removed"),
      );
    });

    it("reports when container was not running", async () => {
      docker.stopContainer.mockResolvedValue(false);

      await stopTtsServer();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("was not running"));
    });

    it("uses custom container name from config", async () => {
      const configPath = join(testConfigDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          servers: [],
          ttsServer: { containerName: "my-custom-tts", port: 8880, image: "img:latest" },
        }),
        "utf-8",
      );

      docker.stopContainer.mockResolvedValue(true);

      await stopTtsServer();

      expect(docker.stopContainer).toHaveBeenCalledWith("my-custom-tts");
    });

    it("exits with error on unexpected failure", async () => {
      docker.stopContainer.mockRejectedValue(new Error("Docker daemon crashed"));

      await expect(stopTtsServer()).rejects.toThrow("process.exit called");

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe("statusTtsServer", () => {
    it("reports Docker not available", async () => {
      docker.isDockerAvailable.mockResolvedValue(false);

      await statusTtsServer();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Docker is not available"),
      );
    });

    it("reports container not found", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.getContainerInfo.mockResolvedValue(null);

      await statusTtsServer();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("not running"));
    });

    it("reports running container with details", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.getContainerInfo.mockResolvedValue({
        running: true,
        status: "running",
        image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
        id: "abc123def456",
      });

      await statusTtsServer();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("TTS server is running"));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("markservant-kokoro-tts"),
      );
    });

    it("reports stopped container", async () => {
      docker.isDockerAvailable.mockResolvedValue(true);
      docker.getContainerInfo.mockResolvedValue({
        running: false,
        status: "exited",
        image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
        id: "abc123def456",
      });

      await statusTtsServer();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("exited"));
    });

    it("uses custom config for container name and port", async () => {
      const configPath = join(testConfigDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          servers: [],
          ttsServer: { containerName: "custom-tts", port: 7777, image: "custom:v1" },
        }),
        "utf-8",
      );

      docker.isDockerAvailable.mockResolvedValue(true);
      docker.getContainerInfo.mockResolvedValue({
        running: true,
        status: "running",
        image: "custom:v1",
        id: "custom12345",
      });

      await statusTtsServer();

      expect(docker.getContainerInfo).toHaveBeenCalledWith("custom-tts");
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("7777"));
    });

    it("exits with error on unexpected failure", async () => {
      docker.isDockerAvailable.mockRejectedValue(new Error("unexpected"));

      await expect(statusTtsServer()).rejects.toThrow("process.exit called");

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });
});
