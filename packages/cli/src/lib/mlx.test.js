import { exec as execCallback, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("./paths.js", () => ({
  getConfigDir: () => "/mock/config/markservant",
}));

vi.mock("./platform.js", () => ({
  findPython3: vi.fn(),
  isPythonVersionOk: vi.fn(),
}));

const { findPython3, isPythonVersionOk } = await import("./platform.js");

const {
  getVenvDir,
  isVenvReady,
  setupVenv,
  startMlxServer,
  stopMlxServer,
  getMlxServerStatus,
  resetVenv,
} = await import("./mlx.js");

function mockExecSuccess(stdout = "") {
  execCallback.mockImplementation((_cmd, opts, callback) => {
    const cb = typeof opts === "function" ? opts : callback;
    cb(null, { stdout, stderr: "" });
  });
}

function mockExecFailure(message = "command failed") {
  execCallback.mockImplementation((_cmd, opts, callback) => {
    const cb = typeof opts === "function" ? opts : callback;
    cb(new Error(message), { stdout: "", stderr: message });
  });
}

describe("mlx.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getVenvDir", () => {
    it("returns venv path under config dir", () => {
      expect(getVenvDir()).toBe("/mock/config/markservant/mlx-venv");
    });
  });

  describe("isVenvReady", () => {
    it("returns true when venv python exists", () => {
      existsSync.mockReturnValue(true);

      expect(isVenvReady()).toBe(true);

      expect(existsSync).toHaveBeenCalledWith("/mock/config/markservant/mlx-venv/bin/python3");
    });

    it("returns false when venv python does not exist", () => {
      existsSync.mockReturnValue(false);

      expect(isVenvReady()).toBe(false);
    });
  });

  describe("setupVenv", () => {
    it("throws when python3 is not found", async () => {
      findPython3.mockResolvedValue(null);
      const log = vi.fn();

      await expect(setupVenv(log)).rejects.toThrow("Python 3 is required");
    });

    it("throws when python version is too old", async () => {
      findPython3.mockResolvedValue("/usr/bin/python3");
      isPythonVersionOk.mockResolvedValue(false);
      const log = vi.fn();

      await expect(setupVenv(log)).rejects.toThrow("Python 3.10+ is required");
    });

    it("creates venv and installs dependencies", async () => {
      findPython3.mockResolvedValue("/opt/homebrew/bin/python3");
      isPythonVersionOk.mockResolvedValue(true);
      existsSync.mockReturnValue(false);
      mkdir.mockResolvedValue(undefined);
      mockExecSuccess("");
      const log = vi.fn();

      await setupVenv(log);

      // Verify venv creation was logged
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Creating Python venv"));
      // Verify install was logged
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Installing mlx-audio"));
      // Verify exec was called (venv creation + pip install)
      expect(execCallback).toHaveBeenCalledTimes(2);
    });

    it("skips venv creation when it already exists", async () => {
      findPython3.mockResolvedValue("/opt/homebrew/bin/python3");
      isPythonVersionOk.mockResolvedValue(true);
      // Venv dir exists
      existsSync.mockReturnValue(true);
      mockExecSuccess("");
      const log = vi.fn();

      await setupVenv(log);

      // Should only call pip install, not venv creation
      expect(execCallback).toHaveBeenCalledTimes(1);
      expect(mkdir).not.toHaveBeenCalled();
    });
  });

  describe("startMlxServer", () => {
    it("throws when venv is not ready", async () => {
      existsSync.mockReturnValue(false);

      await expect(startMlxServer(8880)).rejects.toThrow("MLX venv is not set up");
    });

    it("throws when wrapper script not found", async () => {
      existsSync.mockImplementation((p) => {
        // Venv python exists, but wrapper script doesn't
        if (p.includes("bin/python3")) return true;
        return false;
      });

      await expect(startMlxServer(8880)).rejects.toThrow("wrapper script not found");
    });

    it("spawns detached process and writes PID file", async () => {
      existsSync.mockReturnValue(true);
      const mockChild = { pid: 12345, unref: vi.fn() };
      spawn.mockReturnValue(mockChild);
      writeFile.mockResolvedValue(undefined);

      const pid = await startMlxServer(8880);

      expect(pid).toBe(12345);
      expect(spawn).toHaveBeenCalledWith(
        "/mock/config/markservant/mlx-venv/bin/python3",
        expect.arrayContaining(["8880"]),
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        "/mock/config/markservant/mlx-tts-server.pid",
        "12345",
        "utf-8",
      );
    });
  });

  describe("stopMlxServer", () => {
    it("returns false when no PID file exists", async () => {
      existsSync.mockReturnValue(false);

      const result = await stopMlxServer();

      expect(result).toBe(false);
    });

    it("returns false and cleans up when PID is NaN", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("not-a-number");
      rm.mockResolvedValue(undefined);

      const result = await stopMlxServer();

      expect(result).toBe(false);
      expect(rm).toHaveBeenCalled();
    });

    it("sends SIGTERM and removes PID file when process exists", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("12345");
      rm.mockResolvedValue(undefined);

      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

      const result = await stopMlxServer();

      expect(result).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(12345, 0); // existence check
      expect(mockKill).toHaveBeenCalledWith(12345, "SIGTERM"); // kill
      expect(rm).toHaveBeenCalled();

      mockKill.mockRestore();
    });

    it("returns false and cleans up stale PID when process does not exist", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("99999");
      rm.mockResolvedValue(undefined);

      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => {
        const err = new Error("ESRCH");
        err.code = "ESRCH";
        throw err;
      });

      const result = await stopMlxServer();

      expect(result).toBe(false);
      expect(rm).toHaveBeenCalled();

      mockKill.mockRestore();
    });
  });

  describe("getMlxServerStatus", () => {
    it("returns not running when no PID file", async () => {
      existsSync.mockReturnValue(false);

      const result = await getMlxServerStatus();

      expect(result).toEqual({ running: false, pid: null });
    });

    it("returns running when process exists", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("12345");

      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

      const result = await getMlxServerStatus();

      expect(result).toEqual({ running: true, pid: 12345 });

      mockKill.mockRestore();
    });

    it("returns running when EPERM (process exists but no permission)", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("12345");

      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => {
        const err = new Error("EPERM");
        err.code = "EPERM";
        throw err;
      });

      const result = await getMlxServerStatus();

      expect(result).toEqual({ running: true, pid: 12345 });

      mockKill.mockRestore();
    });

    it("returns not running when process does not exist", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("99999");

      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => {
        const err = new Error("ESRCH");
        err.code = "ESRCH";
        throw err;
      });

      const result = await getMlxServerStatus();

      expect(result).toEqual({ running: false, pid: null });

      mockKill.mockRestore();
    });

    it("returns not running when PID is NaN", async () => {
      existsSync.mockReturnValue(true);
      readFile.mockResolvedValue("garbage");

      const result = await getMlxServerStatus();

      expect(result).toEqual({ running: false, pid: null });
    });
  });

  describe("resetVenv", () => {
    it("returns false when no venv exists", async () => {
      existsSync.mockReturnValue(false);

      const result = await resetVenv();

      expect(result).toBe(false);
      expect(rm).not.toHaveBeenCalled();
    });

    it("removes venv directory and returns true", async () => {
      existsSync.mockReturnValue(true);
      rm.mockResolvedValue(undefined);

      const result = await resetVenv();

      expect(result).toBe(true);
      expect(rm).toHaveBeenCalledWith("/mock/config/markservant/mlx-venv", {
        recursive: true,
        force: true,
      });
    });
  });
});
