import { existsSync } from "node:fs";
import { rm as fsRm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock paths module to use temp directories
vi.mock("../lib/paths.js", async () => {
  return {
    normalizePath: vi.fn((dir) => {
      if (globalThis.__TEST_NORMALIZE_ERROR__) {
        throw new Error(globalThis.__TEST_NORMALIZE_ERROR__);
      }
      return dir || globalThis.__TEST_NORMALIZED_PATH__;
    }),
    getConfigDir: () => globalThis.__TEST_CONFIG_DIR__,
    getConfigPath: () => join(globalThis.__TEST_CONFIG_DIR__, "config.json"),
  };
});

// Mock config module
vi.mock("../lib/config.js", () => ({
  findServer: vi.fn(),
  addServer: vi.fn(),
  updateServerPid: vi.fn(),
  getAllServers: vi.fn(),
}));

// Mock ports module
vi.mock("../lib/ports.js", () => ({
  allocatePort: vi.fn(),
}));

// Mock process module
vi.mock("../lib/process.js", () => ({
  startServer: vi.fn(),
  openInEdge: vi.fn(),
  isServerRunning: vi.fn(),
}));

// Mock launchagent module
vi.mock("../lib/launchagent.js", () => ({
  installLaunchAgent: vi.fn(),
  isLaunchAgentInstalled: vi.fn(),
}));

// Import mocked modules after mocks are set up
const { normalizePath } = await import("../lib/paths.js");
const { findServer, addServer, updateServerPid, getAllServers } = await import("../lib/config.js");
const { allocatePort } = await import("../lib/ports.js");
const { startServer, openInEdge, isServerRunning } = await import("../lib/process.js");
const { installLaunchAgent, isLaunchAgentInstalled } = await import("../lib/launchagent.js");

// Import the command after all mocks are set up
const { default: addCommand } = await import("./add.js");

describe("add command", () => {
  let testConfigDir;
  let consoleSpy;
  let processExitSpy;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testConfigDir = join(
      tmpdir(),
      `markservant-add-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    globalThis.__TEST_CONFIG_DIR__ = testConfigDir;
    globalThis.__TEST_NORMALIZED_PATH__ = "/default/path";
    delete globalThis.__TEST_NORMALIZE_ERROR__;

    // Clear all mocks
    vi.clearAllMocks();

    // Set default mock implementations
    findServer.mockResolvedValue(null);
    allocatePort.mockResolvedValue(9001);
    addServer.mockResolvedValue({
      directory: "/test/dir",
      port: 9001,
      pid: null,
      addedAt: new Date().toISOString(),
    });
    startServer.mockReturnValue(12345);
    updateServerPid.mockResolvedValue(true);
    getAllServers.mockResolvedValue([{ directory: "/test/dir", port: 9001, pid: 12345 }]);
    isLaunchAgentInstalled.mockReturnValue(false);
    installLaunchAgent.mockReturnValue(true);
    isServerRunning.mockReturnValue(true);
    openInEdge.mockResolvedValue(undefined);

    // Mock console.log and console.error
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    // Mock process.exit
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    // Ensure config directory exists
    await mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up the temp directory after each test
    if (existsSync(testConfigDir)) {
      await fsRm(testConfigDir, { recursive: true, force: true });
    }
    delete globalThis.__TEST_CONFIG_DIR__;
    delete globalThis.__TEST_NORMALIZED_PATH__;
    delete globalThis.__TEST_NORMALIZE_ERROR__;

    // Restore console and process.exit
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("path normalization", () => {
    it("normalizes directory path correctly", async () => {
      await addCommand("/some/directory");

      expect(normalizePath).toHaveBeenCalledWith("/some/directory");
    });

    it("uses cwd when no directory provided", async () => {
      await addCommand();

      expect(normalizePath).toHaveBeenCalledWith(undefined);
    });

    it("handles path resolution errors", async () => {
      globalThis.__TEST_NORMALIZE_ERROR__ = "Path does not exist";

      await expect(addCommand("/invalid/path")).rejects.toThrow("process.exit called");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("Cannot resolve path"));
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("Path does not exist"));
    });
  });

  describe("existing server handling", () => {
    it("shows existing server and opens Edge when already running", async () => {
      const existingServer = { directory: "/existing/dir", port: 9000, pid: 11111 };
      findServer.mockResolvedValue(existingServer);
      isServerRunning.mockReturnValue(true);
      globalThis.__TEST_NORMALIZED_PATH__ = "/existing/dir";

      await addCommand("/existing/dir");

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("already being served"));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Opening"));
      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9000");

      // Should not proceed with adding a new server
      expect(allocatePort).not.toHaveBeenCalled();
      expect(addServer).not.toHaveBeenCalled();
      expect(startServer).not.toHaveBeenCalled();
    });

    it("restarts stopped server when already in watch list", async () => {
      const existingServer = { directory: "/existing/dir", port: 9000, pid: 11111, dotfiles: true };
      findServer.mockResolvedValue(existingServer);
      isServerRunning.mockReturnValue(false);
      startServer.mockReturnValue(22222);
      globalThis.__TEST_NORMALIZED_PATH__ = "/existing/dir";

      await addCommand("/existing/dir");

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("stopped. Restarting"));
      expect(startServer).toHaveBeenCalledWith("/existing/dir", 9000, { dotfiles: true });
      expect(updateServerPid).toHaveBeenCalledWith("/existing/dir", 22222);
      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9000");
    });

    it("handles openInEdge error for existing server gracefully", async () => {
      const existingServer = { directory: "/existing/dir", port: 9000, pid: 11111 };
      findServer.mockResolvedValue(existingServer);
      isServerRunning.mockReturnValue(true);
      openInEdge.mockRejectedValue(new Error("Browser not found"));
      globalThis.__TEST_NORMALIZED_PATH__ = "/existing/dir";

      await addCommand("/existing/dir");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to open browser"),
      );
      // Should still show the existing server message
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("already being served"));
    });
  });

  describe("new server creation", () => {
    it("allocates port for new servers", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/new/directory";

      await addCommand("/new/directory");

      expect(allocatePort).toHaveBeenCalled();
    });

    it("handles port allocation errors", async () => {
      allocatePort.mockRejectedValue(new Error("No ports available"));
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/dir";

      await expect(addCommand("/test/dir")).rejects.toThrow("process.exit called");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Error allocating port"),
      );
    });

    it("adds server to config", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(addServer).toHaveBeenCalledWith("/test/directory", 9001, { dotfiles: true });
    });

    it("handles addServer errors", async () => {
      addServer.mockRejectedValue(new Error("Config write failed"));
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/dir";

      await expect(addCommand("/test/dir")).rejects.toThrow("process.exit called");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Error adding server to config"),
      );
    });

    it("starts markserv process", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(startServer).toHaveBeenCalledWith("/test/directory", 9001, { dotfiles: true });
    });

    it("handles server start errors", async () => {
      startServer.mockImplementation(() => {
        throw new Error("markserv not installed");
      });
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/dir";

      await expect(addCommand("/test/dir")).rejects.toThrow("process.exit called");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Error starting markserv"),
      );
    });

    it("updates PID in config", async () => {
      startServer.mockReturnValue(54321);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(updateServerPid).toHaveBeenCalledWith("/test/directory", 54321);
    });

    it("continues despite updateServerPid errors (warning only)", async () => {
      updateServerPid.mockRejectedValue(new Error("PID update failed"));
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      // Should not throw - just show warning
      await addCommand("/test/directory");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Failed to update PID"),
      );
      // Should continue and show success message
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Successfully added"));
    });
  });

  describe("LaunchAgent installation", () => {
    it("installs LaunchAgent on first server when not already installed", async () => {
      getAllServers.mockResolvedValue([{ directory: "/test/dir", port: 9001, pid: 12345 }]);
      isLaunchAgentInstalled.mockReturnValue(false);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(installLaunchAgent).toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Installed LaunchAgent"));
    });

    it("does not install LaunchAgent if already installed", async () => {
      getAllServers.mockResolvedValue([{ directory: "/test/dir", port: 9001, pid: 12345 }]);
      isLaunchAgentInstalled.mockReturnValue(true);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(installLaunchAgent).not.toHaveBeenCalled();
    });

    it("does not install LaunchAgent if not the first server", async () => {
      getAllServers.mockResolvedValue([
        { directory: "/existing/dir", port: 9000, pid: 11111 },
        { directory: "/test/dir", port: 9001, pid: 12345 },
      ]);
      isLaunchAgentInstalled.mockReturnValue(false);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(installLaunchAgent).not.toHaveBeenCalled();
    });

    it("continues despite LaunchAgent installation errors (warning only)", async () => {
      getAllServers.mockResolvedValue([{ directory: "/test/dir", port: 9001, pid: 12345 }]);
      isLaunchAgentInstalled.mockReturnValue(false);
      installLaunchAgent.mockImplementation(() => {
        throw new Error("launchctl failed");
      });
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      // Should not throw - just show warning
      await addCommand("/test/directory");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Failed to install LaunchAgent"),
      );
      // Should continue and show success message
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Successfully added"));
    });
  });

  describe("browser opening", () => {
    it("opens URL in Edge for new server", async () => {
      allocatePort.mockResolvedValue(9042);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(openInEdge).toHaveBeenCalledWith("http://localhost:9042");
    });

    it("continues despite openInEdge errors for new server (warning only)", async () => {
      openInEdge.mockRejectedValue(new Error("Microsoft Edge not found"));
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      // Should not throw - just show warning
      await addCommand("/test/directory");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Failed to open browser"),
      );
      // Should continue and show success message
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Successfully added"));
    });
  });

  describe("success message", () => {
    it("shows success message with correct directory", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/my/markdown/folder";

      await addCommand("/my/markdown/folder");

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("Successfully added"));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("/my/markdown/folder"));
    });

    it("shows success message with correct URL", async () => {
      allocatePort.mockResolvedValue(9500);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("http://localhost:9500"));
    });

    it("shows success message with correct PID", async () => {
      startServer.mockReturnValue(99999);
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining("99999"));
    });
  });

  describe("complete flow", () => {
    it("executes all steps in correct order for new server", async () => {
      const callOrder = [];

      normalizePath.mockImplementation((_dir) => {
        callOrder.push("normalizePath");
        return "/test/path";
      });
      findServer.mockImplementation(async () => {
        callOrder.push("findServer");
        return null;
      });
      allocatePort.mockImplementation(async () => {
        callOrder.push("allocatePort");
        return 9001;
      });
      addServer.mockImplementation(async () => {
        callOrder.push("addServer");
        return { directory: "/test/path", port: 9001 };
      });
      startServer.mockImplementation(() => {
        callOrder.push("startServer");
        return 12345;
      });
      updateServerPid.mockImplementation(async () => {
        callOrder.push("updateServerPid");
        return true;
      });
      getAllServers.mockImplementation(async () => {
        callOrder.push("getAllServers");
        return [{ directory: "/test/path", port: 9001 }];
      });
      isLaunchAgentInstalled.mockImplementation(() => {
        callOrder.push("isLaunchAgentInstalled");
        return true;
      });
      openInEdge.mockImplementation(async () => {
        callOrder.push("openInEdge");
      });

      await addCommand("/test/path");

      expect(callOrder).toEqual([
        "normalizePath",
        "findServer",
        "allocatePort",
        "addServer",
        "startServer",
        "updateServerPid",
        "getAllServers",
        "isLaunchAgentInstalled",
        "openInEdge",
      ]);
    });

    it("stops after finding existing running server", async () => {
      const callOrder = [];

      normalizePath.mockImplementation((_dir) => {
        callOrder.push("normalizePath");
        return "/existing/path";
      });
      findServer.mockImplementation(async () => {
        callOrder.push("findServer");
        return { directory: "/existing/path", port: 9000, pid: 11111 };
      });
      isServerRunning.mockImplementation(() => {
        callOrder.push("isServerRunning");
        return true;
      });
      openInEdge.mockImplementation(async () => {
        callOrder.push("openInEdge");
      });

      await addCommand("/existing/path");

      expect(callOrder).toEqual(["normalizePath", "findServer", "isServerRunning", "openInEdge"]);

      // These should NOT be called
      expect(allocatePort).not.toHaveBeenCalled();
      expect(addServer).not.toHaveBeenCalled();
      expect(startServer).not.toHaveBeenCalled();
      expect(updateServerPid).not.toHaveBeenCalled();
    });
  });

  describe("unexpected errors", () => {
    it("handles unexpected errors gracefully", async () => {
      getAllServers.mockRejectedValue(new Error("Unexpected database corruption"));
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await expect(addCommand("/test/directory")).rejects.toThrow("process.exit called");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("Unexpected error"));
    });
  });

  describe("dotfiles option", () => {
    beforeEach(() => {
      // Reset the normalizePath mock to default behavior
      normalizePath.mockImplementation((dir) => {
        if (globalThis.__TEST_NORMALIZE_ERROR__) {
          throw new Error(globalThis.__TEST_NORMALIZE_ERROR__);
        }
        return dir || globalThis.__TEST_NORMALIZED_PATH__;
      });
    });

    it("passes dotfiles option to addServer when enabled", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory", { dotfiles: true });

      expect(addServer).toHaveBeenCalledWith("/test/directory", 9001, { dotfiles: true });
    });

    it("passes dotfiles option to startServer when enabled", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory", { dotfiles: true });

      expect(startServer).toHaveBeenCalledWith("/test/directory", 9001, { dotfiles: true });
    });

    it("passes true dotfiles by default when option not provided", async () => {
      globalThis.__TEST_NORMALIZED_PATH__ = "/test/directory";

      await addCommand("/test/directory");

      // showDotfiles defaults to true (since !undefined === true)
      expect(addServer).toHaveBeenCalledWith("/test/directory", 9001, { dotfiles: true });
      expect(startServer).toHaveBeenCalledWith("/test/directory", 9001, { dotfiles: true });
    });
  });
});
