import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer";

describe("server regressions", () => {
  it("does not expose the removed Webflow mapping endpoint", async () => {
    const repository = { saveChannelCredentials: vi.fn() };
    const app = createServer({ repository: repository as any });

    const response = await app.inject({
      method: "PUT",
      url: "/brands/brand-1/channels/webflow/mapping",
      payload: {
        siteId: " ",
        collectionId: "",
        fieldMap: { title: "name", body: "post-body" }
      }
    });

    expect(response.statusCode).toBe(404);
    expect(repository.saveChannelCredentials).not.toHaveBeenCalled();
  });
});
