import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// src/__tests__/templates.test.ts -> repo root is four levels up.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const read = (relPath: string): string => readFileSync(path.join(repoRoot, relPath), "utf8");

const traceabilityVersion = (
  JSON.parse(read("packages/traceability/package.json")) as { version: string }
).version;
const pinnedTraceabilityPackage = `@pound79/specproof-traceability@${traceabilityVersion}`;

const TEMPLATE_CONFIGS = [
  "templates/playwright/specproof.config.yaml",
  "templates/flutter/specproof.config.yaml",
];

// The traceability engine exposes four bins; templates wire all four so the
// drift / bless / list / stats workflow works out of the box.
const EXPECTED_COMMANDS: Record<string, string> = {
  traceabilityCheck: `npx -y -p ${pinnedTraceabilityPackage} specproof-check`,
  traceabilityUpdate: `npx -y -p ${pinnedTraceabilityPackage} specproof-update`,
  traceabilityList: `npx -y -p ${pinnedTraceabilityPackage} specproof-list`,
  traceabilityStats: `npx -y -p ${pinnedTraceabilityPackage} specproof-stats`,
};

describe("template traceability commands", () => {
  for (const config of TEMPLATE_CONFIGS) {
    it(`${config} defines check / update / list with the npx -p form`, () => {
      const text = read(config);
      for (const [key, value] of Object.entries(EXPECTED_COMMANDS)) {
        expect(text).toContain(`${key}: "${value}"`);
      }
    });
  }
});

// `@pound79/specproof-traceability` exposes multiple bins, so invoking it via
// npx without `-p` cannot resolve a binary and fails at runtime. The `-p` flag
// (or a direct bin name after install) is required. Guard against the bare
// form regressing into any scaffold or skill doc.
//
// Built from parts so this guard file itself does not contain the literal bare
// form, keeping repo-wide greps for the bad form clean.
const BARE_NPX_FORM = ["npx", "-y", "@pound79/specproof-traceability"].join(" ");
const SCAN_DIRS = ["templates", "plugins", "docs"];
const SCAN_FILES = ["README.md"];
const TEXT_EXTENSIONS = new Set([".md", ".yaml", ".yml"]);

const textFilesUnder = (relDir: string): string[] =>
  readdirSync(path.join(repoRoot, relDir), { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => !entry.includes("node_modules") && TEXT_EXTENSIONS.has(path.extname(entry)))
    .map((entry) => path.join(relDir, entry));

describe("no stale npx form in scaffolds / docs", () => {
  const files = [...SCAN_DIRS.flatMap(textFilesUnder), ...SCAN_FILES];

  for (const file of files) {
    it(`${file} uses the npx -p form (no bare multi-bin npx)`, () => {
      expect(read(file).includes(BARE_NPX_FORM)).toBe(false);
    });
  }
});

const WORKFLOW_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/release.yml",
  "templates/playwright/github-workflows/specproof-drift-check.yml",
  "templates/flutter/github-workflows/specproof-drift-check.yml",
];

const EXPECTED_ACTION_SHAS: Record<string, string> = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
  "actions/github-script": "f28e40c7f34bde8b3046d885e986cb6290c5673b",
  "actions/upload-artifact": "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
  "actions/download-artifact": "9000827ccba6bdab643e8b6fd33ac0654aef8333",
};

describe("GitHub Actions supply-chain pins", () => {
  for (const file of WORKFLOW_FILES) {
    it(`${file} pins every third-party action to its reviewed full SHA`, () => {
      const uses = [...read(file).matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, action, ref] of uses) {
        expect(ref, `${file}: ${action}`).toBe(EXPECTED_ACTION_SHAS[action]);
      }
    });
  }
});

describe("dependency security workflow", () => {
  it("runs npm audit at moderate severity with read-only contents", () => {
    const workflow = read(".github/workflows/dependency-review.yml");
    expect(workflow).toMatch(/permissions:\n\s+contents: read/);
    expect(workflow).toContain("npm audit --audit-level=moderate");
  });
});

type WorkflowStep = {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};
type WorkflowJob = {
  needs?: string | string[];
  permissions?: Record<string, unknown>;
  steps?: WorkflowStep[];
};

// Inspect the parsed YAML, not the text: a commented-out `# id-token: write`
// or `# cache: npm` still matches a text search but is not in effect.
const jobOf = (workflowText: string, name: string): WorkflowJob => {
  const job = (parse(workflowText) as { jobs?: Record<string, WorkflowJob> }).jobs?.[name];
  if (!job) throw new Error(`release.yml has no \`${name}\` job`);
  return job;
};

const publishJobOf = (workflowText: string): WorkflowJob => jobOf(workflowText, "publish");

// The job that can mint an npm publish credential must not run dependency or
// build code: no install, no lifecycle scripts, no test/build. (It does run
// scripts/verify-publish-tarball.sh, checked out from the same commit as the
// workflow.) Each shell command (split on newlines, `;`, `&&`, `||`, `|` and `$(`) may
// call npm only as `npm view` or `npm publish` of a tarball (which runs no
// lifecycle scripts, unlike publishing a directory or `--workspace`), and node
// only as `node -p` reading a package.json version; npx/yarn/pnpm/bun and
// backticks are rejected. Other tools are not inspected: this is a regression
// test for this workflow, not a security boundary (whoever can edit the
// workflow can edit this test).
const PUBLISH_JOB_ACTIONS = [
  "actions/checkout@",
  "actions/setup-node@",
  "actions/download-artifact@",
];
const OTHER_PACKAGE_RUNNERS = /\b(npx|yarn|pnpm|bun)\b|`/;
const COMMAND_SEPARATOR = /\n|;|&&|\|\||\||\$\(/;
const TARBALL_ARG = /^\s+"?\.\/[^\s"]+\.tgz"?(\s|$)/;
const VERSION_READ_ARG =
  /^\s+-p\s+"require\(process\.env\.GITHUB_WORKSPACE \+ '\/[\w/.-]+\/package\.json'\)\.version"/;

const isAllowedPublishCommand = (command: string): boolean => {
  const npmCallsAllowed = [...command.matchAll(/\bnpm\s+(\S+)/g)].every(
    ({ 1: subcommand, index }, _, calls) =>
      calls.length === 1 &&
      (subcommand === "view" ||
        (subcommand === "publish" &&
          TARBALL_ARG.test(command.slice((index ?? 0) + `npm ${subcommand}`.length)))),
  );
  const nodeCallsAllowed = [...command.matchAll(/\bnode\b/g)].every(({ index }) =>
    VERSION_READ_ARG.test(command.slice((index ?? 0) + "node".length)),
  );
  return npmCallsAllowed && nodeCallsAllowed;
};

const isAllowedPublishScript = (run: string): boolean =>
  !OTHER_PACKAGE_RUNNERS.test(run) && run.split(COMMAND_SEPARATOR).every(isAllowedPublishCommand);

const runsNoProjectCode = (job: WorkflowJob): boolean =>
  (job.steps ?? []).every(
    (step) =>
      isAllowedPublishScript(step.run ?? "") &&
      (step.uses === undefined ||
        PUBLISH_JOB_ACTIONS.some((prefix) => step.uses?.startsWith(prefix))),
  );

const setupNodeStepsOf = (job: WorkflowJob): WorkflowStep[] =>
  (job.steps ?? []).filter((step) => step.uses?.startsWith("actions/setup-node@"));

const usesNoDependencyCache = (job: WorkflowJob): boolean => {
  const steps = setupNodeStepsOf(job);
  return (
    steps.length > 0 &&
    steps.every(
      (step) => !("cache" in (step.with ?? {})) && step.with?.["package-manager-cache"] === false,
    )
  );
};

const packagingJobsUseNoCache = (workflowText: string): boolean =>
  ["build", "publish"].every((name) => usesNoDependencyCache(jobOf(workflowText, name)));

describe("release workflow", () => {
  const workflow = read(".github/workflows/release.yml");
  const publishJob = publishJobOf(workflow);

  it("publishes through npm trusted publishing without a long-lived token", () => {
    expect(publishJob.permissions?.["id-token"]).toBe("write");
    for (const step of publishJob.steps ?? []) {
      expect(step.env ?? {}).not.toHaveProperty("NODE_AUTH_TOKEN");
    }
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it("does not restore a dependency cache in the jobs that build or publish the tarballs", () => {
    expect(packagingJobsUseNoCache(workflow)).toBe(true);
  });

  it("builds and tests in a job that cannot mint an npm publish credential", () => {
    const buildJob = jobOf(workflow, "build");
    expect(buildJob.permissions).toBeDefined();
    expect(buildJob.permissions?.["id-token"]).toBeUndefined();
    expect((buildJob.steps ?? []).some((step) => /\bnpm ci\b/.test(step.run ?? ""))).toBe(true);
    expect(
      (buildJob.steps ?? []).some((step) => step.uses?.startsWith("actions/upload-artifact@")),
    ).toBe(true);
  });

  // The build job's output is what gets published, so dependencies' install
  // scripts must not run there; the build itself runs as explicit steps.
  it("installs dependencies in the build job without running install scripts", () => {
    const installs = (jobOf(workflow, "build").steps ?? [])
      .map((step) => step.run ?? "")
      .filter((run) => /\bnpm (ci|install|i)\b/.test(run));
    expect(installs.length).toBeGreaterThan(0);
    for (const run of installs) {
      expect(run).toMatch(/^npm ci --ignore-scripts$/m);
    }
  });

  // --ignore-scripts also skips the workspaces' `prepare` build, and some tests
  // run the built CLI (cli/dist), so the build has to come before the tests.
  it("builds before testing in the build job", () => {
    const runs = (jobOf(workflow, "build").steps ?? []).map((step) => step.run ?? "");
    const build = runs.findIndex((run) => /^npm run build$/m.test(run));
    const test = runs.findIndex((run) => /^npm test$/m.test(run));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(test).toBeGreaterThanOrEqual(0);
    expect(build).toBeLessThan(test);
  });

  it("publishes the built tarballs without running project code", () => {
    expect([publishJob.needs ?? []].flat()).toContain("build");
    expect(
      (publishJob.steps ?? []).some((step) => step.uses?.startsWith("actions/download-artifact@")),
    ).toBe(true);
    expect(runsNoProjectCode(publishJob)).toBe(true);
  });

  // What the check refuses is covered by release-publish-steps.test.ts, which
  // runs these steps against crafted tarballs.
  it("verifies each tarball and pins the registry before publishing", () => {
    const publishRuns = (publishJob.steps ?? [])
      .map((step) => step.run ?? "")
      .filter((run) => /\bnpm publish\b/.test(run));
    expect(publishRuns).toHaveLength(2);
    for (const run of publishRuns) {
      const lines = run.split("\n");
      const checkLine = lines.findIndex((line) =>
        /^bash "\$GITHUB_WORKSPACE\/scripts\/verify-publish-tarball\.sh" "\.\/[^"]+\.tgz"/.test(
          line,
        ),
      );
      const publishLine = lines.findIndex((line) => /\bnpm publish\b/.test(line));
      expect(checkLine).toBeGreaterThanOrEqual(0);
      expect(checkLine).toBeLessThan(publishLine);
      expect(lines[publishLine]).toContain("--registry https://registry.npmjs.org");
    }
  });

  it("detects project code added to the publish job", () => {
    const withStep = (step: WorkflowStep): WorkflowJob => ({
      ...publishJob,
      steps: [...(publishJob.steps ?? []), step],
    });
    expect(runsNoProjectCode(withStep({ run: "npm ci" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "npm run build" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "npx tsc" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "npm t" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "node scripts/prepack.mjs" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "npm publish --workspace cli --provenance" }))).toBe(
      false,
    );
    expect(runsNoProjectCode(withStep({ run: "npm publish --provenance" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "npm view x version && npm ci" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: 'npm publish "./x.tgz" ; npm run build' }))).toBe(
      false,
    );
    expect(runsNoProjectCode(withStep({ run: "npm view x; node scripts/evil.js" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ run: "echo `npm ci`" }))).toBe(false);
    expect(runsNoProjectCode(withStep({ uses: "actions/cache@v4" }))).toBe(false);
    expect(
      runsNoProjectCode(withStep({ run: 'npm publish "./x-1.0.0.tgz" --provenance --tag next' })),
    ).toBe(true);
  });

  it("creates the pack destination before npm pack writes to it", () => {
    const packStep = (jobOf(workflow, "build").steps ?? []).find((step) =>
      /\bnpm pack\b/.test(step.run ?? ""),
    );
    const destination = packStep?.run?.match(/--pack-destination\s+(\S+)/)?.[1];
    expect(destination).toBeDefined();
    const lines = (packStep?.run ?? "").split("\n");
    const mkdirLine = lines.findIndex((line) => line.includes(`mkdir -p ${destination}`));
    const packLine = lines.findIndex((line) => /\bnpm pack\b/.test(line));
    expect(mkdirLine).toBeGreaterThanOrEqual(0);
    expect(mkdirLine).toBeLessThan(packLine);
  });

  it("treats commented-out settings as absent", () => {
    const withoutIdToken = workflow.replace(/^(\s+)id-token: write/m, "$1# id-token: write");
    expect(withoutIdToken).not.toBe(workflow);
    expect(publishJobOf(withoutIdToken).permissions?.["id-token"]).toBeUndefined();

    const withoutCacheOptOut = workflow.replace(
      /^(\s+)package-manager-cache: false/m,
      "$1# package-manager-cache: false",
    );
    expect(withoutCacheOptOut).not.toBe(workflow);
    expect(packagingJobsUseNoCache(withoutCacheOptOut)).toBe(false);

    const withCache = workflow.replace(
      /^(\s+)package-manager-cache: false/m,
      "$1package-manager-cache: false\n$1cache: npm",
    );
    expect(withCache).not.toBe(workflow);
    expect(packagingJobsUseNoCache(withCache)).toBe(false);

    const publishWithCache = workflow.replace(
      /(registry-url: https:\/\/registry\.npmjs\.org\n)(\s+)package-manager-cache: false/,
      "$1$2package-manager-cache: false\n$2cache: npm",
    );
    expect(publishWithCache).not.toBe(workflow);
    expect(packagingJobsUseNoCache(publishWithCache)).toBe(false);
  });
});
