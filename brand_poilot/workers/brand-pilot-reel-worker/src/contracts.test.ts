import { describe, expect, it } from "vitest";
import { parseReelJob } from "./contracts.js";

describe("reel worker contract", () => {
  it("accepts only V3 reel generate jobs", () => {
    const job = {
      id: "job-1", generationId: "generation-1", outputId: "output-1",
      workspaceId: "workspace-1", brandId: "brand-1", jobType: "generate",
      outputFormat: "reel", status: "processing", payload: {}, leaseToken: "lease-1",
    };
    expect(parseReelJob(job)).toEqual(job);
    expect(() => parseReelJob({ ...job, outputFormat: "marketing" })).toThrow("reel_job_invalid");
    expect(() => parseReelJob({ ...job, jobType: "analyze" })).toThrow("reel_job_invalid");
  });
});
