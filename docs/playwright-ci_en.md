# Running Playwright E2E in CI with a separate backend

English | [日本語](playwright-ci.md)

This guide is for a frontend whose API, database and cache are maintained in another repository. Create a consumer-owned GitHub Actions workflow alongside the generated PR drift check. The runner executes scenarios and determines whether they pass. The traceability CLI compares files.

## Schedule runs and identify the revisions

Run the full suite on a UTC schedule on the default branch and on manual dispatch. Keep jobs that need secrets and the App token off PR events, including `pull_request_target` and `workflow_run`. Use a concurrency group to avoid duplicate runs. Identify the frontend by `github.sha`. Resolve the backend commit using the App described below. Use that exact pair when comparing, checking out and marking a run.

Use a cache key of `e2e-<frontend SHA>-<backend SHA>`. Look it up with `actions/cache/restore` and `lookup-only: true`. On a hit, skip every subsequent setup and test step. Support an explicit manual `force` input. When saving, write a small marker file containing the pair; the cache needs a real file. Document one policy:

- Mark only successful runs to retry transient failures on the next schedule. A persistent failure will consume resources until resolved.
- Mark completed attempts to save that cost. Notify on failure and use `force` to retry infrastructure failures. Require a signal that the tests actually started. Exclude cancellations and failures before the test step. For a marking job after a test failure, use an explicit status condition such as `!cancelled() && needs.e2e.outputs.ran == 'true' && (needs.e2e.result == 'success' || needs.e2e.result == 'failure')`. The default job condition implies success.

Markers save compute. Their presence cannot certify a passing run. A cache entry can be evicted, in which case the pair runs again. The pair cannot account for mutable image tags, unpinned dependencies or time-dependent data. Pin Compose images by digest.

Do not use an artifact name as a skip marker. Artifacts belong to runs across branches and repositories of origin. A name or branch-name filter alone does not establish provenance; even a filter checking the head repository and non-null workflow run leaves trusted-branch jobs able to write artifacts. Branch-scoped caches avoid implementing these filters. When migrating, stop uploading and reading the old artifact marker, remove any Actions read permission granted solely for that lookup and let existing artifacts expire. The first cache-based run executes again.

## Limit cache writes

For manual runs, select the frontend branch as the workflow ref (the Actions branch selector or `gh workflow run --ref <branch>`). Cache scope and Environment restrictions then follow that ref. Checking out a branch selected by an input inside a default-branch run executes its install scripts, build and tests with the default branch's access. Even a dependency update branch can contain third-party code.

If a frontend branch input is unavoidable, restrict selectable branches or require Environment approval. Pass the input through an environment variable, validate it with `git check-ref-format --branch`, resolve it to a commit and check out that commit. Suppress the default-branch marker and trace upload on such runs. Rebuild dependencies from the lockfile in trusted jobs.

Set workflow-level `cache-mode: read` and grant `cache-mode: write-only` only to a separate marking job. A read-only cache action prevents accidental writes through that action. Job cache permissions apply at the token level; blocking direct cache writes with the same token is an inference from those permissions. Verify the result by checking the cache list after attempting a save. A cache action can log a warning while the job still succeeds. Set read-only mode explicitly on reusable workflows too.

Use GitHub-hosted or disposable runners per job. A persistent self-hosted runner can retain files or tools from a previous job. The test job's tokens must lack permission to trigger other write-capable workflows. Other workflows with write access to the same branch scope can still populate its cache. In particular, inspect default-branch push, schedule and dispatch workflows and any PR/comment-triggered workflow granted cache writes explicitly.

Restore dependencies and browsers with `actions/cache/restore` only. The combined cache action, setup actions and Docker's GHA cache exporter can save implicitly. Use `package-manager-cache: false` for setup-node, including projects that declare npm through `packageManager` or `devEngines.packageManager`.

Keep the marking job free of checkout, dependency installs and workspace composite actions. It creates the marker and saves it on a clean runner. A simple workflow accepts the key from the E2E job, so code in that job can affect what gets marked. A separate trusted revision-resolution job can supply the key. Even then, test code can still affect the result of its own run.

## Read a separate private backend

Use a dedicated GitHub App installed only on the backend repository, with Contents read permission. Keep its long-lived private key in an Environment limited to the default branch. Request a repository-specific, read-only installation token, allow its normal expiry (about an hour) and end-of-job revocation. Pass it as the checkout action’s `token` with `persist-credentials: false`. Retrieve the revision with the API. Keep tokens out of repository URLs. Pin actions by commit SHA with a version comment.

The [shared example workflow](playwright-ci.md#scheduled-workflow-example) shows lookup, checkout and the separate marking job. Replace placeholders and apply the cache-hit condition to **every** subsequent E2E step.

### Selecting a backend branch

If the backend branch comes from an input, separate credentialed fetching from execution. The [two-job example](playwright-ci.md#backend-branch-workflow-example) resolves a validated branch through the branches endpoint, checks the returned name and SHA, archives the source without Git metadata, and passes the archive to an unprivileged test job. The trusted fetch job executes no backend code. Only the E2E job consumes the source artifact. Any markers must use the revision from the trusted fetch job and require an empty branch input.

Use this variant only if every frontend repository reader (including Apps) may read the backend source and every person allowed to dispatch may select the backend branches exposed by the input. Anyone with artifact access can download it during retention. A public frontend is unsuitable for private backend source. Keep retention short. The test job needs neither Environment secrets nor write permissions. If private dependencies cannot be fetched without executing backend code in the fetch job, use another design. Credentialed jobs must not consume artifacts produced or replaceable by the E2E job.

If the jobs must share a runner context, combine protected-branch allowlisting before using credentials, required Environment reviewers with self-review disabled, and suppression of markers and traces for nonempty inputs. To approve reviewed content, resolve and display the SHA in a separate job before approval and check out that SHA after approval. Approving a moving branch name alone does not pin its contents.

## Start the backend and build the frontend

- On Linux, files written by root inside a container may be unreadable to the runner. Run writers with the runner's UID and GID, or copy files out with `docker compose cp`. Export `HOST_UID` and `HOST_GID` from `id -u` and `id -g` and use those names in Compose's `user` setting. Bash reserves `UID`.
- Define health checks and use `docker compose up --wait`. Run migrations before seeding. Warm up the service before starting tests to avoid first-request timeouts.
- Generate disposable signing keys per run, mask them before use and pass them only where needed. Use a temporary env file for the backend if considering the trace exception below. Avoid printing resolved Compose settings. Use synthetic accounts and data, a fresh database per run and only the services created for the run.
- Populate public build-time settings such as the API URL from a tracked example with CI-specific overrides before building. An empty URL can send requests to the frontend itself and cause widespread 404s, including in fresh local worktrees. Use the template preflight checks.
- If frontend and E2E packages require different Node versions, set up the version required by the E2E package after the frontend build. Keep package-manager caching disabled.

## Results, logs and artifacts

Use Playwright's list or line reporter. Failure messages can include actual UI strings and URLs; keep sensitive values out of assertions. Limit service diagnostics to status and health checks. Record the two revisions, outcome and failed scenario names. Reproduce locally at the same commits, using the runner's OS in a container when needed.

By default, keep saved sessions, HTML reports, screenshots, videos and traces out of CI artifacts. Traces can contain cookies, form input, screenshots and response bodies. Masking a secret in logs does not redact an artifact. A disposable runner also limits what survives cancellation.

### Limited retention for CI-only failures

Use this exception only when all of the following hold:

- Credentials, signing keys, database and sessions are disposable per run and unusable elsewhere. Only synthetic data is present.
- The test process and its children have no signing keys in their environment, arguments or workspace. Keep backend-only secrets outside the workspace in a temporary file available only to the intended container. Do not export them via `GITHUB_ENV`.
- Neither server exposes stack traces, environment values, debug toolbars or configuration, including in error responses. Verify an exception, a missing URL and a GraphQL error. Check custom error handlers and the frontend dev server as well. In Rails disable local-request error pages; in Django set `DEBUG=False` and configure `ALLOWED_HOSTS`; in Laravel set `APP_DEBUG=false` and regenerate cached config; in Express set `NODE_ENV=production` at server startup after installing dependencies. Recheck connections, required keys and cookies if changing modes.
- No production or shared keys reach the backend or frontend build. Tests do not attach backend logs or write them into the results directory.
- The frontend repository is private and every reader, including integrated Apps, may see the backend responses. Upload only failed runs with **both** branch inputs empty. Match the actual input names: a misspelling can evaluate as empty.
- Upload only the E2E package’s `test-results/` with short retention (the example uses seven days). Exclude `playwright/.auth/` and the HTML report. Review other screenshots, videos and test attachments in that directory too.

If any condition cannot be verified, reproduce the failure locally. See the [shared upload example](playwright-ci.md#trace-upload-example).
