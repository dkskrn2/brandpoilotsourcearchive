import { describe, expect, it } from "vitest";
import { parseBlogJob } from "./contracts.js";

describe("blog worker claim contract", () => {
  const job = { id: "job", generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobType: "generate", outputFormat: "blog", status: "processing", payload: {}, leaseToken: "lease" };
  it("accepts only exact V3 generate jobs", () => {
    expect(parseBlogJob(job)).toEqual(job);
    expect(() => parseBlogJob({ ...job, jobType: "analyze" })).toThrow("blog_job_invalid");
    expect(() => parseBlogJob({ ...job, outputFormat: "card_news" })).toThrow("blog_job_invalid");
    expect(() => parseBlogJob({ ...job, contentType: "blog" })).toThrow("blog_job_invalid");
  });
});
