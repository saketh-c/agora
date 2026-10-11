#!/usr/bin/env node
import { run, crashReport } from '../src/main.js';

/*
 * Set the exit code rather than calling process.exit(). On Linux and macOS a write to a
 * pipe is asynchronous, so exiting immediately truncates anything still buffered, which
 * silently cuts off large output such as `agora cities --json | jq` or a redirect to a
 * file. Letting the process end on its own lets stdout drain first.
 *
 * Expected problems (bad input, a cancelled setup) are handled inside run() and come back
 * as exit codes. Anything else is a bug: print one line instead of a Node stack trace, and
 * the full stack only when AGORA_DEBUG (or DEBUG) is set, for bug reports.
 */
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code || 0;
  },
  (err) => {
    for (const line of crashReport(err, { debug: Boolean(process.env.AGORA_DEBUG || process.env.DEBUG) })) console.error(line);
    process.exitCode = 1;
  },
);
