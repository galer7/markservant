import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfigDir,
  getConfigPath,
  getLaunchAgentPath,
  normalizePath,
  resolveServerRoot,
} from "./paths.js";

// Mock node:fs module
vi.mock("node:fs", () => ({
  realpathSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock node:os module
vi.mock("node:os", () => ({
  homedir: vi.fn(),
}));

// Mock node:child_process module
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";

describe("normalizePath", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cwd when no directory provided", () => {
    const mockCwd = "/Users/test/projects";
    vi.spyOn(process, "cwd").mockReturnValue(mockCwd);
    realpathSync.mockReturnValue(mockCwd);

    const result = normalizePath();

    expect(result).toBe(mockCwd);
    expect(realpathSync).toHaveBeenCalledWith(mockCwd);
  });

  it("returns cwd when empty string provided", () => {
    const mockCwd = "/Users/test/projects";
    vi.spyOn(process, "cwd").mockReturnValue(mockCwd);
    realpathSync.mockReturnValue(mockCwd);

    const result = normalizePath("");

    expect(result).toBe(mockCwd);
    expect(realpathSync).toHaveBeenCalledWith(mockCwd);
  });

  it("returns absolute path for relative input", () => {
    const mockCwd = "/Users/test/projects";
    const relativeInput = "src/lib";
    const expectedAbsolute = "/Users/test/projects/src/lib";

    vi.spyOn(process, "cwd").mockReturnValue(mockCwd);
    realpathSync.mockReturnValue(expectedAbsolute);

    const result = normalizePath(relativeInput);

    expect(result).toBe(expectedAbsolute);
    expect(realpathSync).toHaveBeenCalledWith(expectedAbsolute);
  });

  it("handles absolute path input correctly", () => {
    const absoluteInput = "/Users/test/other";
    realpathSync.mockReturnValue(absoluteInput);

    const result = normalizePath(absoluteInput);

    expect(result).toBe(absoluteInput);
    expect(realpathSync).toHaveBeenCalledWith(absoluteInput);
  });

  it("removes trailing slashes", () => {
    const inputPath = "/Users/test/projects/";
    const realPathWithTrailing = "/Users/test/projects/";
    const expectedPath = "/Users/test/projects";

    realpathSync.mockReturnValue(realPathWithTrailing);

    const result = normalizePath(inputPath);

    expect(result).toBe(expectedPath);
  });

  it("removes multiple trailing slashes", () => {
    const inputPath = "/Users/test/projects///";
    const realPathWithTrailing = "/Users/test/projects///";

    realpathSync.mockReturnValue(realPathWithTrailing);

    const result = normalizePath(inputPath);

    expect(result).toBe("/Users/test/projects");
  });

  it("preserves root path when only slashes", () => {
    const inputPath = "/";
    realpathSync.mockReturnValue("/");

    const result = normalizePath(inputPath);

    expect(result).toBe("/");
  });

  it("throws error for non-existent path", () => {
    const nonExistentPath = "/path/that/does/not/exist";
    const error = new Error("ENOENT: no such file or directory");
    error.code = "ENOENT";

    realpathSync.mockImplementation(() => {
      throw error;
    });

    expect(() => normalizePath(nonExistentPath)).toThrow("ENOENT");
  });

  it("throws error when realpathSync fails", () => {
    const invalidPath = "/invalid/path";
    const error = new Error("Permission denied");
    error.code = "EACCES";

    realpathSync.mockImplementation(() => {
      throw error;
    });

    expect(() => normalizePath(invalidPath)).toThrow("Permission denied");
  });

  it("resolves symlinks through realpathSync", () => {
    const symlinkPath = "/Users/test/symlink";
    const realPath = "/Users/test/actual/path";

    realpathSync.mockReturnValue(realPath);

    const result = normalizePath(symlinkPath);

    expect(result).toBe(realPath);
    expect(realpathSync).toHaveBeenCalled();
  });
});

describe("getConfigDir", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ~/.config/markservant path", () => {
    const mockHome = "/Users/testuser";
    homedir.mockReturnValue(mockHome);

    const result = getConfigDir();

    expect(result).toBe("/Users/testuser/.config/markservant");
  });

  it("uses os.homedir()", () => {
    const mockHome = "/home/linux-user";
    homedir.mockReturnValue(mockHome);

    getConfigDir();

    expect(homedir).toHaveBeenCalled();
  });

  it("returns correct path for different home directories", () => {
    const mockHome = "/var/root";
    homedir.mockReturnValue(mockHome);

    const result = getConfigDir();

    expect(result).toBe("/var/root/.config/markservant");
  });
});

describe("getConfigPath", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ~/.config/markservant/config.json", () => {
    const mockHome = "/Users/testuser";
    homedir.mockReturnValue(mockHome);

    const result = getConfigPath();

    expect(result).toBe("/Users/testuser/.config/markservant/config.json");
  });

  it("uses getConfigDir as base", () => {
    const mockHome = "/home/user";
    homedir.mockReturnValue(mockHome);

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    expect(configPath).toBe(`${configDir}/config.json`);
  });

  it("returns correct path for different home directories", () => {
    const mockHome = "/root";
    homedir.mockReturnValue(mockHome);

    const result = getConfigPath();

    expect(result).toBe("/root/.config/markservant/config.json");
  });
});

describe("getLaunchAgentPath", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ~/Library/LaunchAgents/com.markservant.plist", () => {
    const mockHome = "/Users/testuser";
    homedir.mockReturnValue(mockHome);

    const result = getLaunchAgentPath();

    expect(result).toBe("/Users/testuser/Library/LaunchAgents/com.markservant.plist");
  });

  it("uses os.homedir()", () => {
    const mockHome = "/Users/macuser";
    homedir.mockReturnValue(mockHome);

    getLaunchAgentPath();

    expect(homedir).toHaveBeenCalled();
  });

  it("returns correct path for different home directories", () => {
    const mockHome = "/var/home/admin";
    homedir.mockReturnValue(mockHome);

    const result = getLaunchAgentPath();

    expect(result).toBe("/var/home/admin/Library/LaunchAgents/com.markservant.plist");
  });

  it("constructs macOS LaunchAgent path correctly", () => {
    const mockHome = "/Users/developer";
    homedir.mockReturnValue(mockHome);

    const result = getLaunchAgentPath();

    expect(result).toContain("Library/LaunchAgents");
    expect(result.endsWith("com.markservant.plist")).toBe(true);
  });
});

describe("resolveServerRoot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns git root when path is a directory inside a git repo", () => {
    statSync.mockReturnValue({ isDirectory: () => true });
    execSync.mockReturnValue("/projects/repo\n");
    realpathSync.mockReturnValue("/projects/repo");

    const result = resolveServerRoot("/projects/repo/docs");

    expect(execSync).toHaveBeenCalledWith("git rev-parse --show-toplevel", {
      cwd: "/projects/repo/docs",
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    expect(result).toBe("/projects/repo");
  });

  it("returns git root when path is a file inside a git repo", () => {
    statSync.mockReturnValue({ isDirectory: () => false });
    execSync.mockReturnValue("/projects/repo\n");
    realpathSync.mockReturnValue("/projects/repo");

    const result = resolveServerRoot("/projects/repo/docs/guide.md");

    expect(execSync).toHaveBeenCalledWith("git rev-parse --show-toplevel", {
      cwd: "/projects/repo/docs",
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    expect(result).toBe("/projects/repo");
  });

  it("returns the directory itself when not in a git repo", () => {
    statSync.mockReturnValue({ isDirectory: () => true });
    execSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    const result = resolveServerRoot("/tmp/somedir");

    expect(result).toBe("/tmp/somedir");
  });

  it("returns parent directory for a file not in a git repo", () => {
    statSync.mockReturnValue({ isDirectory: () => false });
    execSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    const result = resolveServerRoot("/tmp/somedir/file.md");

    expect(result).toBe("/tmp/somedir");
  });
});
