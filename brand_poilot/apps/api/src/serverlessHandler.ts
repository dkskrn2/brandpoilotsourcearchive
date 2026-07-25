import type { IncomingMessage, ServerResponse } from "node:http";

interface FastifyServerlessApp {
  ready(): PromiseLike<unknown>;
  server: {
    emit(event: "request", request: IncomingMessage, response: ServerResponse): boolean;
  };
}

export function createServerlessHandler(app: FastifyServerlessApp) {
  let readyPromise: PromiseLike<unknown> | undefined;

  return async function serverlessHandler(request: IncomingMessage, response: ServerResponse) {
    readyPromise ??= app.ready();
    await readyPromise;
    app.server.emit("request", request, response);
  };
}
