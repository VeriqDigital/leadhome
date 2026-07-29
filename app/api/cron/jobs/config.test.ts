import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vercel jobs cron configuration", () => {
  it("schedules the production route at the committed daily cadence", () => {
    const config = JSON.parse(
      readFileSync("vercel.json", "utf8"),
    ) as {
      $schema?: string;
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(config.crons).toContainEqual({
      path: "/api/cron/jobs",
      schedule: "0 10 * * *",
    });
  });

  it("preserves the documented local worker command", () => {
    const packageJson = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["jobs:worker"]).toBe(
      "node scripts/jobs-worker.mjs --poll",
    );
  });
});
