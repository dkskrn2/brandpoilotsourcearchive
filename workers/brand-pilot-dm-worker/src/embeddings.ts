export async function createEmbedding({ text, apiKey, model = "text-embedding-3-small", fetchImpl = fetch }: {
  text: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}) {
  const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: text, dimensions: 1536 }),
  });
  const payload = await response.json().catch(() => ({})) as { data?: Array<{ embedding?: unknown }> };
  const embedding = payload.data?.[0]?.embedding;
  if (!response.ok || !Array.isArray(embedding) || embedding.length !== 1536 || !embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`embedding_request_failed:${response.status}`);
  }
  return embedding as number[];
}
