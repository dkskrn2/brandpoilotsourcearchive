import { MetaGraphRequestError, postMetaGraphForm } from "./metaGraph.js";

export interface InstagramDmSendInput {
  accessToken: string;
  instagramBusinessAccountId: string;
  recipientId: string;
  text: string;
  tag?: "HUMAN_AGENT";
}

export interface InstagramDmSendResult {
  externalMessageId: string;
}

export interface InstagramDmSendErrorClassification {
  status: "failed" | "unknown";
  errorCode: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function classifyInstagramDmSendError(error: unknown): InstagramDmSendErrorClassification {
  if (error instanceof MetaGraphRequestError) {
    if (error.status >= 500 && error.status <= 599) {
      return { status: "unknown", errorCode: `meta_graph_${error.status}` };
    }
    return { status: "failed", errorCode: `meta_graph_${error.status}` };
  }
  const record = asRecord(error);
  const code = typeof record?.code === "string" ? record.code.toLowerCase() : null;
  const message = error instanceof Error ? error.message : "instagram_dm_send_failed";
  return {
    status: "unknown",
    errorCode: code ? `instagram_dm_${code}` : message.slice(0, 200),
  };
}

export async function sendInstagramDirectMessage(
  input: InstagramDmSendInput,
  dependencies: {
    graphVersion?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<InstagramDmSendResult> {
  const graphVersion = dependencies.graphVersion ?? process.env.META_GRAPH_VERSION ?? "v23.0";
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const payload = await postMetaGraphForm({
    path: `/${input.instagramBusinessAccountId}/messages`,
    body: {
      recipient: JSON.stringify({ id: input.recipientId }),
      message: JSON.stringify({ text: input.text }),
      ...(input.tag ? { tag: input.tag } : {}),
      access_token: input.accessToken,
    },
    fetchImpl,
    graphVersion,
    host: "graph.instagram.com",
  });
  const record = asRecord(payload);
  const externalMessageId = typeof record?.message_id === "string"
    ? record.message_id
    : typeof record?.id === "string"
      ? record.id
      : null;
  if (!externalMessageId) throw new Error("instagram_dm_message_id_missing");
  return { externalMessageId };
}
