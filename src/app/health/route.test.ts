import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => import("@/test/next-server"));

describe("GET /health", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "family-planner-health-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers ok after a real query against the database", async () => {
    vi.stubEnv("DATABASE_PATH", path.join(dir, "health.db"));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 without details when the database cannot be opened", async () => {
    // A path under a *file*: mkdirSync fails with ENOTDIR, nothing can create it.
    vi.stubEnv("DATABASE_PATH", "/dev/null/nope/family-planner.db");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error" });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
