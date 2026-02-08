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
    it("returns versioned brew python3.12 on Apple Silicon", async () => {
      existsSync.mockImplementation((p) => p === "/opt/homebrew/bin/python3.12");
      mockExecByCommand({
        "python3.12": { stdout: "3 12\n" },
      });

      const result = await findPython3();

      expect(result).toBe("/opt/homebrew/bin/python3.12");
    });

    it("returns unversioned brew python3 when versioned not present", async () => {
      existsSync.mockImplementation((p) => p === "/opt/homebrew/bin/python3");
      mockExecByCommand({
        "/opt/homebrew/bin/python3": { stdout: "3 11\n" },
      });

      const result = await findPython3();

      expect(result).toBe("/opt/homebrew/bin/python3");
    });

    it("skips old system python and finds brew python", async () => {
      existsSync.mockImplementation(
        (p) => p === "/usr/bin/python3" || p === "/opt/homebrew/bin/python3.12",
      );
      mockExecByCommand({
        "python3.12": { stdout: "3 12\n" },
        "/usr/bin/python3": { stdout: "3 9\n" },
        "which python3": { stdout: "/usr/bin/python3\n" },
      });

      const result = await findPython3();

      expect(result).toBe("/opt/homebrew/bin/python3.12");
    });

    it("falls back to PATH python3 when brew not installed", async () => {
      existsSync.mockReturnValue(false);
      mockExecByCommand({
        "which python3": { stdout: "/some/custom/python3\n" },
        "/some/custom/python3": { stdout: "3 11\n" },
      });

      const result = await findPython3();

      expect(result).toBe("/some/custom/python3");
    });

    it("falls back to xcrun python3", async () => {
      existsSync.mockReturnValue(false);
      mockExecByCommand({
        "which python3": { err: "not found" },
        "xcrun --find python3": { stdout: "/Library/Developer/CommandLineTools/usr/bin/python3\n" },
        "/Library/Developer/CommandLineTools/usr/bin/python3": { stdout: "3 10\n" },
      });

      const result = await findPython3();

      expect(result).toBe("/Library/Developer/CommandLineTools/usr/bin/python3");
    });

    it("returns system python if it is 3.10+", async () => {
      existsSync.mockImplementation((p) => p === "/usr/bin/python3");
      mockExecByCommand({
        "which python3": { stdout: "/usr/bin/python3\n" },
        "/usr/bin/python3": { stdout: "3 10\n" },
      });

      const result = await findPython3();

      expect(result).toBe("/usr/bin/python3");
    });

    it("returns null when all candidates are too old", async () => {
      existsSync.mockImplementation((p) => p === "/usr/bin/python3");
      mockExecByCommand({
        "which python3": { stdout: "/usr/bin/python3\n" },
        "/usr/bin/python3": { stdout: "3 9\n" },
      });

      const result = await findPython3();

      expect(result).toBeNull();
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
