import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocatePort, isPortFree, PORT_RANGE } from "./ports.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./config.js", () => ({
  loadConfig: vi.fn(),
}));

import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";

describe("ports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PORT_RANGE", () => {
    it("has min of 9000", () => {
      expect(PORT_RANGE.min).toBe(9000);
    });

    it("has max of 9999", () => {
      expect(PORT_RANGE.max).toBe(9999);
    });
  });

  describe("isPortFree", () => {
    it("returns true when port is free", () => {
      execSync.mockImplementation(() => {
        throw new Error("lsof: no process found");
      });

      const result = isPortFree(9000);

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith("lsof -i :9000", { stdio: "ignore" });
    });

    it("returns false when port is in use", () => {
      execSync.mockImplementation(() => {
        return Buffer.from(
          "node    12345 user   22u  IPv4 0x123456789      0t0  TCP *:9000 (LISTEN)",
        );
      });

      const result = isPortFree(9000);

      expect(result).toBe(false);
      expect(execSync).toHaveBeenCalledWith("lsof -i :9000", { stdio: "ignore" });
    });
  });

  describe("allocatePort", () => {
    it("returns a port in the valid range", async () => {
      loadConfig.mockResolvedValue({ servers: [] });
      execSync.mockImplementation(() => {
        throw new Error("lsof: no process found");
      });

      const port = await allocatePort();

      expect(port).toBeGreaterThanOrEqual(PORT_RANGE.min);
      expect(port).toBeLessThanOrEqual(PORT_RANGE.max);
    });

    it("does not return ports already assigned in config", async () => {
      const assignedPorts = [9000, 9001, 9002, 9003, 9004];
      loadConfig.mockResolvedValue({
        servers: assignedPorts.map((port) => ({ port })),
      });
      execSync.mockImplementation(() => {
        throw new Error("lsof: no process found");
      });

      // Run multiple times to increase confidence
      for (let i = 0; i < 50; i++) {
        const port = await allocatePort();
        expect(assignedPorts).not.toContain(port);
        expect(port).toBeGreaterThanOrEqual(PORT_RANGE.min);
        expect(port).toBeLessThanOrEqual(PORT_RANGE.max);
      }
    });

    it("skips ports that are in use on the system", async () => {
      loadConfig.mockResolvedValue({ servers: [] });

      let callCount = 0;
      execSync.mockImplementation(() => {
        callCount++;
        // First few calls indicate port is in use, then it's free
        if (callCount < 5) {
          return Buffer.from("node    12345 user   22u  IPv4");
        }
        throw new Error("lsof: no process found");
      });

      const port = await allocatePort();

      expect(port).toBeGreaterThanOrEqual(PORT_RANGE.min);
      expect(port).toBeLessThanOrEqual(PORT_RANGE.max);
      expect(callCount).toBeGreaterThanOrEqual(5);
    });

    it("throws error after too many attempts when all ports are in use", async () => {
      loadConfig.mockResolvedValue({ servers: [] });
      // Always indicate port is in use
      execSync.mockImplementation(() => {
        return Buffer.from("node    12345 user   22u  IPv4");
      });

      await expect(allocatePort()).rejects.toThrow(
        "Failed to allocate an available port after 100 attempts. " +
          `All ports in range ${PORT_RANGE.min}-${PORT_RANGE.max} may be in use.`,
      );

      expect(execSync).toHaveBeenCalledTimes(100);
    });

    it("throws error after too many attempts when all generated ports are assigned", async () => {
      // Create a set of ports that will be returned by Math.random
      const mockPorts = [9100, 9101, 9102];
      let portIndex = 0;

      // Mock Math.random to return predictable values
      const originalRandom = Math.random;
      vi.spyOn(Math, "random").mockImplementation(() => {
        const port = mockPorts[portIndex % mockPorts.length];
        portIndex++;
        // Convert port back to the random value that would generate it
        return (port - PORT_RANGE.min) / (PORT_RANGE.max - PORT_RANGE.min + 1);
      });

      // All mock ports are assigned in config
      loadConfig.mockResolvedValue({
        servers: mockPorts.map((port) => ({ port })),
      });

      // Port would be free if checked, but we never get there because it's assigned
      execSync.mockImplementation(() => {
        throw new Error("lsof: no process found");
      });

      await expect(allocatePort()).rejects.toThrow(
        "Failed to allocate an available port after 100 attempts.",
      );

      // execSync should never be called because ports are skipped due to being assigned
      expect(execSync).not.toHaveBeenCalled();

      Math.random = originalRandom;
    });
  });
});
