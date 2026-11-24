# Quality gates

English | [日本語](quality-gates.md)

Follow the [contributor checks](../CONTRIBUTING.md#set-up-and-verify) in order. TypeScript uses strict checking. Biome checks unreachable code, debugger statements and loose equality. Formatting checks quotes, semicolons, indentation and line endings.

Vitest measures all TypeScript sources including CLI entry points, excluding tests. Some CLI paths run in child processes and their coverage is not attributed to the Vitest worker. Each workspace enforces its own thresholds. The current percentages and worker limits are in the [CLI configuration](../cli/vitest.config.ts) and the [engine configuration](../packages/traceability/vitest.config.ts). Lowering a threshold requires justification and review.

The engine uses one Vitest worker and the CLI uses up to two to keep large-manifest tests within their timeouts. Script tests run one file at a time. Concurrency tests still exercise parallel operations within a case. Boundary tests cover 20,001 references. Signal tests use a Git stub and verify exit status, restoration and single cleanup on the real exit path.
