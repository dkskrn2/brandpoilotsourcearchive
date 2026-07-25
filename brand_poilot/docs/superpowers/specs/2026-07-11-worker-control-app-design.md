# Worker Control App Design

## Goal

Provide a small control app that runs on an image-worker PC and starts, stops, or runs the existing image worker once while showing its local process state and central API health.

## Scope

- Bind only to `127.0.0.1` on the worker PC.
- Manage one child worker process at a time.
- Provide start, stop, run-once, and read-only status controls.
- Report the configured central API `/health` response, worker process PID, current mode, last completed job, and latest error.
- Keep the existing worker queue, Blob upload, Codex rendering, and publishing contracts unchanged.

## Exclusions

- No remote control from another device.
- No database, Supabase, Meta, or Codex credentials in the UI.
- No process command input from the browser.
- No multi-worker orchestration or scheduling UI.

## Architecture

`src/control.ts` starts a small Node HTTP server on localhost. It owns a single child process that invokes the current worker entrypoint in either `watch` or `run-once` mode. Fixed API endpoints call a process controller; browser input cannot affect command arguments.

The controller reads the worker's JSON output, tracks lifecycle state, and probes `BRAND_PILOT_API_URL/health`. A single static HTML page polls the local status endpoint and exposes Start, Stop, and Run Once controls. The control server inherits the worker's existing `.env` through `dotenv/config` and never returns secret values.

## States

| State | Meaning |
| --- | --- |
| `stopped` | No worker child process is active. |
| `watching` | Continuous worker process is alive and polling. |
| `running_once` | One worker execution is active. |
| `idle` | The most recent execution found no job. |
| `completed` | The most recent execution finished a job. |
| `failed` | The worker exited or reported an error. |

Starting watch mode or one-shot mode while another mode is active returns a conflict. Stop terminates the managed worker process and its descendants. A control-server restart does not claim ownership of a pre-existing worker process.

## Verification

- Unit test lifecycle transitions with a fake child-process launcher.
- Unit test health success and failure without exposing environment values.
- Unit test all HTTP control routes using the Node server's request handler.
- Run worker type checks and the complete test suite.
- Manually start the local control app, verify central health, start/stop it, and verify a one-shot idle response.
