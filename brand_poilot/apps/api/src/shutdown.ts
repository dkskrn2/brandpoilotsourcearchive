interface ClosableApp {
  close(): Promise<unknown>;
}

interface ClosablePool {
  end(): Promise<unknown>;
}

interface ShutdownFailureLogger {
  error(
    context: { event: string; errorCode: string; signal: NodeJS.Signals },
    message: string,
  ): unknown;
}

export function logShutdownFailure(
  logger: ShutdownFailureLogger,
  signal: NodeJS.Signals,
) {
  logger.error(
    {
      event: "api_shutdown_failed",
      errorCode: "shutdown_failed",
      signal,
    },
    "api_shutdown_failed",
  );
}

export function createShutdown(app: ClosableApp, pool: ClosablePool) {
  let pending: Promise<void> | undefined;

  return (signal: NodeJS.Signals) => {
    pending ??= (async () => {
      console.info("api_shutdown_started", { signal });
      let appError: unknown;
      let poolError: unknown;

      try {
        await app.close();
      } catch (error) {
        appError = error;
      }

      try {
        await pool.end();
      } catch (error) {
        poolError = error;
      }

      if (appError && poolError) {
        throw new AggregateError([appError, poolError], "api_shutdown_failed");
      }
      if (appError) throw appError;
      if (poolError) throw poolError;
      console.info("api_shutdown_completed", { signal });
    })();

    return pending;
  };
}
