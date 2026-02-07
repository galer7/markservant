import { existsSync } from "node:fs";
import { rm as fsRm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock paths module
vi.mock("../lib/paths.js", async () => {
  return {
    normalizePath: vi.fn((dir) => {
      if (globalThis.__TEST_THROW_ENOENT__) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      if (globalThis.__TEST_THROW_UNEXPECTED__) {
        throw new Error("Unexpected error");
      }
      return globalThis.__TEST_NORMALIZED_PATH__ || dir;
    }),
    resolveServerRoot: vi.fn(),
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, "config.json"),
  };
});

// Mock config module
vi.mock("../lib/config.js", () => ({
  findServerForPath: vi.fn(),
  addServer: vi.fn(),
  getAllServers: vi.fn(),
  updateServerPid: vi.fn(),
}));

// Mock process module
vi.mock("../lib/process.js", () => ({
  openInEdge: vi.fn(),
  startServer: vi.fn(),
}));

// Mock ports module
vi.mock("../lib/ports.js", () => ({
  allocatePort: vi.fn(),
}));

// Mock launchagent module
vi.mock("../lib/launchagent.js", () => ({
  installLaunchAgent: vi.fn(),
  isLaunchAgentInstalled: vi.fn(),
}));

// Import mocked modules after mocking
const { normalizePath, resolveServerRoot } = await import("../lib/paths.js");
const { findServerForPath, addServer, getAllServers, updateServerPid } = await import(
  "../lib/config.js"
);
const { openInEdge, startServer } = await import("../lib/process.js");
const { allocatePort } = await import("../lib/ports.js");
const { installLaunchAgent, isLaunchAgentInstalled } = await import("../lib/launchagent.js");

// Import the command after all mocks are set up
const { default: openCommand } = await import("./open.js");

describe("open command", () => {
  let testConfigDir;
  let consoleSpy;
  let originalExitCode;

  beforeEach(async () => {
    testConfigDir = join(
      tmpdir(),
      `markservant-open-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = "/default/path";
    globalThis.__TEST_THROW_ENOENT__ = false;
    globalThis.__TEST_THROW_UNEXPECTED__ = false;

    vi.clearAllMocks();

    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    await mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testConfigDir)) {
      await fsRm(testConfigDir, { recursive: true, force: true });
    }
    delete globalThis.__TEST_CONFIG_DIR__;
    delete globalThis.__TEST_NORMALIZED_PATH__;
    delete globalThis.__TEST_THROW_ENOENT__;
    delete globalThis.__TEST_THROW_UNEXPECTED__;

    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();

    process.exitCode = originalExitCode;
  });

  describe("path normalization", () => {
    it("normalizes path correctly", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/some/directory");

      expect(normalizePath).toHaveBeenCalledWith("/some/directory");
    });

    it("uses cwd when no path provided", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand();

      expect(normalizePath).toHaveBeenCalledWith(undefined);
    });
  });

  describe("server found", () => {
    it("opens root URL when subpath is empty", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo");

      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9000");
    });

    it("opens URL with subpath for nested path", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "docs/guide.md",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo/docs/guide.md");

      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9000/docs/guide.md");
    });

    it("encodes special characters in subpath", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "docs/my file.md",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo/docs/my file.md");

      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9000/docs/my%20file.md");
    });

    it("shows success message after opening", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/test/directory");

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Opened"),
        expect.stringContaining("http://localhost:9000"),
        expect.stringContaining("Microsoft Edge"),
      );
    });

    it("does not set exitCode on success", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/test/directory");

      expect(process.exitCode).toBeUndefined();
    });

    it("does not attempt auto-add when server found", async () => {
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/test/directory");

      expect(resolveServerRoot).not.toHaveBeenCalled();
      expect(addServer).not.toHaveBeenCalled();
    });
  });

  describe("auto-add when not found", () => {
    it("auto-adds server root and opens with subpath", async () => {
      findServerForPath.mockResolvedValue(null);
      globalThis.__TEST_NORMALIZED_PATH__ = "/projects/repo/docs/guide.md";
      resolveServerRoot.mockReturnValue("/projects/repo");
      allocatePort.mockResolvedValue(9050);
      addServer.mockResolvedValue({});
      startServer.mockReturnValue(12345);
      updateServerPid.mockResolvedValue(true);
      getAllServers.mockResolvedValue([{ directory: "/projects/repo" }]);
      isLaunchAgentInstalled.mockReturnValue(true);
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo/docs/guide.md");

      expect(addServer).toHaveBeenCalledWith("/projects/repo", 9050);
      expect(startServer).toHaveBeenCalledWith("/projects/repo", 9050);
      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9050/docs/guide.md");
    });

    it("opens root URL when path equals server root", async () => {
      findServerForPath.mockResolvedValue(null);
      globalThis.__TEST_NORMALIZED_PATH__ = "/projects/repo";
      resolveServerRoot.mockReturnValue("/projects/repo");
      allocatePort.mockResolvedValue(9050);
      addServer.mockResolvedValue({});
      startServer.mockReturnValue(12345);
      updateServerPid.mockResolvedValue(true);
      getAllServers.mockResolvedValue([{ directory: "/projects/repo" }]);
      isLaunchAgentInstalled.mockReturnValue(true);
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo");

      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9050");
    });

    it("installs LaunchAgent on first server", async () => {
      findServerForPath.mockResolvedValue(null);
      globalThis.__TEST_NORMALIZED_PATH__ = "/projects/repo";
      resolveServerRoot.mockReturnValue("/projects/repo");
      allocatePort.mockResolvedValue(9050);
      addServer.mockResolvedValue({});
      startServer.mockReturnValue(12345);
      updateServerPid.mockResolvedValue(true);
      getAllServers.mockResolvedValue([{ directory: "/projects/repo" }]);
      isLaunchAgentInstalled.mockReturnValue(false);
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo");

      expect(installLaunchAgent).toHaveBeenCalled();
    });

    it("does not install LaunchAgent when already installed", async () => {
      findServerForPath.mockResolvedValue(null);
      globalThis.__TEST_NORMALIZED_PATH__ = "/projects/repo";
      resolveServerRoot.mockReturnValue("/projects/repo");
      allocatePort.mockResolvedValue(9050);
      addServer.mockResolvedValue({});
      startServer.mockReturnValue(12345);
      updateServerPid.mockResolvedValue(true);
      getAllServers.mockResolvedValue([{ directory: "/projects/repo" }]);
      isLaunchAgentInstalled.mockReturnValue(true);
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo");

      expect(installLaunchAgent).not.toHaveBeenCalled();
    });

    it("does not install LaunchAgent when other servers exist", async () => {
      findServerForPath.mockResolvedValue(null);
      globalThis.__TEST_NORMALIZED_PATH__ = "/projects/repo";
      resolveServerRoot.mockReturnValue("/projects/repo");
      allocatePort.mockResolvedValue(9050);
      addServer.mockResolvedValue({});
      startServer.mockReturnValue(12345);
      updateServerPid.mockResolvedValue(true);
      getAllServers.mockResolvedValue([
        { directory: "/other/server" },
        { directory: "/projects/repo" },
      ]);
      isLaunchAgentInstalled.mockReturnValue(false);
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo");

      expect(installLaunchAgent).not.toHaveBeenCalled();
    });

    it("shows auto-add message", async () => {
      findServerForPath.mockResolvedValue(null);
      globalThis.__TEST_NORMALIZED_PATH__ = "/projects/repo";
      resolveServerRoot.mockReturnValue("/projects/repo");
      allocatePort.mockResolvedValue(9050);
      addServer.mockResolvedValue({});
      startServer.mockReturnValue(12345);
      updateServerPid.mockResolvedValue(true);
      getAllServers.mockResolvedValue([{ directory: "/projects/repo" }]);
      isLaunchAgentInstalled.mockReturnValue(true);
      openInEdge.mockResolvedValue();

      await openCommand("/projects/repo");

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Auto-adding"),
        expect.stringContaining("/projects/repo"),
        expect.anything(),
      );
    });
  });

  describe("error handling", () => {
    it("handles path resolution errors (ENOENT)", async () => {
      globalThis.__TEST_THROW_ENOENT__ = true;

      await openCommand("/non/existent/path");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Error"),
        expect.stringContaining("does not exist"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("shows the provided path in ENOENT error message", async () => {
      globalThis.__TEST_THROW_ENOENT__ = true;

      await openCommand("/some/missing/path");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("/some/missing/path"),
      );
    });

    it("shows cwd in ENOENT error message when no path provided", async () => {
      globalThis.__TEST_THROW_ENOENT__ = true;
      const originalCwd = process.cwd();

      await openCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining(originalCwd),
      );
    });

    it("re-throws unexpected errors", async () => {
      globalThis.__TEST_THROW_UNEXPECTED__ = true;

      await expect(openCommand("/test/directory")).rejects.toThrow("Unexpected error");
    });

    it("does not set exitCode for unexpected errors", async () => {
      globalThis.__TEST_THROW_UNEXPECTED__ = true;

      try {
        await openCommand("/test/directory");
      } catch {
        // Expected to throw
      }

      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("findServerForPath integration", () => {
    it("calls findServerForPath with normalized path", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/normalized/path";
      findServerForPath.mockResolvedValue({
        server: { port: 9000 },
        subpath: "",
      });
      openInEdge.mockResolvedValue();

      await openCommand("/raw/path");

      expect(findServerForPath).toHaveBeenCalledWith("/normalized/path");
    });
  });
});
