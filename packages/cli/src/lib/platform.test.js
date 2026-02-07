import { exec as execCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  platform: vi.fn(),
  arch: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

const { isAppleSilicon, findPython3, isPythonVersionOk } = await import("./platform.js");

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

describe("platform.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isAppleSilicon", () => {
    it("returns true on macOS ARM64", () => {
      platform.mockReturnValue("darwin");
      arch.mockReturnValue("arm64");
      expect(isAppleSilicon()).toBe(true);
    });

    it("returns false on macOS x86_64", () => {
      platform.mockReturnValue("darwin");
      arch.mockReturnValue("x64");
      expect(isAppleSilicon()).toBe(false);
    });

    it("returns false on Linux ARM64", () => {
      platform.mockReturnValue("linux");
      arch.mockReturnValue("arm64");
      expect(isAppleSilicon()).toBe(false);
    });

    it("returns false on Windows", () => {
      platform.mockReturnValue("win32");
      arch.mockReturnValue("x64");
      expect(isAppleSilicon()).toBe(false);
    });
  });

  describe("findPython3", () => {
    it("returns python3 from PATH when available", async () => {
      mockExecSuccess("/opt/homebrew/bin/python3\n");
      existsSync.mockReturnValue(false);

      const result = await findPython3();

      expect(result).toBe("/opt/homebrew/bin/python3");
    });

    it("falls back to Homebrew Apple Silicon path", async () => {
      mockExecFailure("not found");
      existsSync.mockImplementation((p) => p === "/opt/homebrew/bin/python3");

      const result = await findPython3();

      expect(result).toBe("/opt/homebrew/bin/python3");
    });

    it("falls back to Homebrew Intel path", async () => {
      mockExecFailure("not found");
      existsSync.mockImplementation((p) => p === "/usr/local/bin/python3");

      const result = await findPython3();

      expect(result).toBe("/usr/local/bin/python3");
    });

    it("falls back to xcrun", async () => {
      mockExecByCommand({
        "which python3": { err: "not found" },
        "xcrun --find python3": { stdout: "/usr/bin/python3\n" },
      });
      existsSync.mockReturnValue(false);

      const result = await findPython3();

      expect(result).toBe("/usr/bin/python3");
    });

    it("falls back to system python", async () => {
      mockExecFailure("not found");
      existsSync.mockImplementation((p) => p === "/usr/bin/python3");

      const result = await findPython3();

      expect(result).toBe("/usr/bin/python3");
    });

    it("returns null when no python3 found", async () => {
      mockExecFailure("not found");
      existsSync.mockReturnValue(false);

      const result = await findPython3();

      expect(result).toBeNull();
    });
  });

  describe("isPythonVersionOk", () => {
    it("returns true for Python 3.12", async () => {
      mockExecSuccess("3 12\n");

      const result = await isPythonVersionOk("/usr/bin/python3");

      expect(result).toBe(true);
    });

    it("returns true for Python 3.10", async () => {
      mockExecSuccess("3 10\n");

      const result = await isPythonVersionOk("/usr/bin/python3");

      expect(result).toBe(true);
    });

    it("returns false for Python 3.9", async () => {
      mockExecSuccess("3 9\n");

      const result = await isPythonVersionOk("/usr/bin/python3");

      expect(result).toBe(false);
    });

    it("returns false for Python 2.7", async () => {
      mockExecSuccess("2 7\n");

      const result = await isPythonVersionOk("/usr/bin/python3");

      expect(result).toBe(false);
    });

    it("returns false when python command fails", async () => {
      mockExecFailure("No such file or directory");

      const result = await isPythonVersionOk("/nonexistent/python3");

      expect(result).toBe(false);
    });
  });
});
