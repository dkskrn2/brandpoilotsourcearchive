import { describe, expect, it } from "vitest";
import { parseCardNewsJob } from "./contracts.js";

describe("card-news worker claim contract", () => {
  const job = { id: "job", generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobType: "generate", outputFormat: "card_news", status: "processing", payload: {}, leaseToken: "lease" };
  it("accepts only exact V3 generate jobs", () => {
    expect(parseCardNewsJob(job)).toEqual(job);
    expect(() => parseCardNewsJob({ ...job, jobType: "analyze" })).toThrow("card_news_job_invalid");
    expect(() => parseCardNewsJob({ ...job, outputFormat: "reel" })).toThrow("card_news_job_invalid");
    expect(() => parseCardNewsJob({ ...job, contentType: "card_news" })).toThrow("card_news_job_invalid");
  });
});
