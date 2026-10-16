import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Runs the real `run` scripts of the release workflow's publish job against
// crafted tarballs and artifact directories, with `npm` replaced by a stub that
// only records its arguments (the verify script still uses the real npm's
// pacote, found next to `node`). The publish job must refuse, before `npm
// publish` is ever called, anything other than the two expected tarballs, and
// any tarball from which npm would read a package.json other than the
// checked-out one.

// src/__tests__/release-publish-steps.test.ts -> repo root is four levels up.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const workflowText = readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8");
const VERIFY_SCRIPTS = ["scripts/verify-publish-tarball.sh", "scripts/verify-publish-manifest.mjs"];

type Step = { name?: string; run?: string };
type PublishJob = { env?: Record<string, string>; steps: Step[] };

const publishJob = (parse(workflowText) as { jobs: { publish: PublishJob } }).jobs.publish;

const stepRun = (name: string): string => {
  const run = publishJob.steps.find((step) => step.name === name)?.run;
  if (!run) throw new Error(`release.yml has no "${name}" step in the publish job`);
  return run;
};

const VERSION = "1.2.3";

const PACKAGES = [
  {
    name: "@pound79/specproof-traceability",
    workspaceDir: "packages/traceability",
    tarball: (version: string) => `pound79-specproof-traceability-${version}.tgz`,
  },
  {
    name: "@pound79/specproof",
    workspaceDir: "cli",
    tarball: (version: string) => `pound79-specproof-${version}.tgz`,
  },
] as const;
type Package = (typeof PACKAGES)[number];

// The checked-out package.json; `npm pack` stores it in the tarball unchanged.
const trustedManifest = (pkg: Package): string =>
  `${JSON.stringify({ name: pkg.name, version: VERSION, publishConfig: { access: "public" } }, null, 2)}\n`;

const STUB_NPM = `#!/bin/sh
echo "$*" >> "$NPM_CALLS"
case "$1" in
  view) exit 1 ;;
esac
exit 0
`;

// --- minimal ustar writer, so fixtures control every entry name and type ---

type FileEntry = { name: string; body?: string; type?: "0" | "1" | "2" | "5"; linkname?: string };
// A single 512-byte zero block: system tar may stop reading there, while
// node-tar (npm) reads on unless two zero blocks follow.
type Entry = FileEntry | "lone zero block";

const octal = (value: number, width: number): string =>
  `${value.toString(8).padStart(width - 1, "0")}\0`;

const entryBlocks = (entry: Entry): Buffer[] => {
  if (entry === "lone zero block") return [Buffer.alloc(512)];
  const { name, body = "", type = "0", linkname = "" } = entry;
  const data = Buffer.from(type === "0" ? body : "");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(type === "5" ? 0o755 : 0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(data.length, 12), 124);
  header.write(octal(0, 12), 136);
  header.fill(" ", 148, 156);
  header.write(type, 156);
  header.write(linkname, 157, 100, "utf8");
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [header, data, padding];
};

const tgz = (entries: Entry[]): Buffer =>
  gzipSync(Buffer.concat([...entries.flatMap(entryBlocks), Buffer.alloc(1024)]));

// --- harness -------------------------------------------------------------

type RunResult = { status: number | null; output: string; npmCalls: string[] };

// Runs `runs` in order in a fresh tarball directory holding `files`, stopping
// at the first failing step as GitHub does. `{{root}}` in a file's content is
// replaced with the harness's temporary root, for fixtures that point outside
// the tarball.
const runSteps = (
  runs: string[],
  files: Record<string, Buffer | string> | ((root: string) => Record<string, Buffer | string>),
): RunResult => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-publish-step-"));
  try {
    const workspace = path.join(root, "workspace");
    for (const pkg of PACKAGES) {
      mkdirSync(path.join(workspace, pkg.workspaceDir), { recursive: true });
      writeFileSync(path.join(workspace, pkg.workspaceDir, "package.json"), trustedManifest(pkg));
    }
    mkdirSync(path.join(workspace, "scripts"));
    for (const script of VERIFY_SCRIPTS) {
      copyFileSync(path.join(repoRoot, script), path.join(workspace, script));
    }

    const tarballs = path.join(root, "tarballs");
    mkdirSync(tarballs);
    const contents = typeof files === "function" ? files(root) : files;
    for (const [name, content] of Object.entries(contents)) {
      writeFileSync(path.join(tarballs, name), content);
    }

    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "npm"), STUB_NPM);
    chmodSync(path.join(bin, "npm"), 0o755);
    const npmCallsFile = path.join(root, "npm-calls.log");
    writeFileSync(npmCallsFile, "");

    let status: number | null = 0;
    let output = "";
    for (const [index, run] of runs.entries()) {
      const script = path.join(root, `step-${index}.sh`);
      writeFileSync(script, run);
      // GitHub runs a `run:` without `shell:` as `bash -e {0}`.
      const result = spawnSync("bash", ["-e", script], {
        cwd: tarballs,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          ...(publishJob.env ?? {}),
          GITHUB_WORKSPACE: workspace,
          NPM_CALLS: npmCallsFile,
        },
      });
      if (result.error) throw result.error;
      status = result.status;
      output += result.stdout + result.stderr;
      if (status !== 0) break;
    }
    return {
      status,
      output,
      npmCalls: readFileSync(npmCallsFile, "utf8").split("\n").filter(Boolean),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const published = (result: RunResult): boolean =>
  result.npmCalls.some((call) => call.startsWith("publish "));

const validTarball = (pkg: Package, extra: Entry[] = []): Buffer =>
  tgz([
    { name: "package/package.json", body: trustedManifest(pkg) },
    { name: "package/dist/index.js", body: "" },
    ...extra,
  ]);

const validArtifact = (): Record<string, Buffer> =>
  Object.fromEntries(PACKAGES.map((pkg) => [pkg.tarball(VERSION), validTarball(pkg)]));

// Each case spawns bash and node (which loads npm's pacote); leave room beyond
// vitest's 5s default.
const STEP_TEST_OPTIONS = { timeout: 30_000 };

describe.each(PACKAGES)("release publish step for $name", STEP_TEST_OPTIONS, (pkg) => {
  const run = stepRun(`Publish ${pkg.name}`);
  const trusted = trustedManifest(pkg);
  const evil = `${JSON.stringify(
    {
      name: pkg.name,
      version: VERSION,
      publishConfig: { access: "public", "https-proxy": "http://proxy.invalid:8080" },
    },
    null,
    2,
  )}\n`;
  const publishWith = (tarball: Buffer | ((root: string) => Buffer)): RunResult =>
    runSteps([run], (root) => ({
      ...validArtifact(),
      [pkg.tarball(VERSION)]: typeof tarball === "function" ? tarball(root) : tarball,
    }));

  it("publishes a tarball holding the checked-out package.json, with the registry pinned", () => {
    const result = publishWith(validTarball(pkg));
    expect(result.status, result.output).toBe(0);
    expect(result.npmCalls).toContain(
      `publish ./${pkg.tarball(VERSION)} --registry https://registry.npmjs.org --provenance --tag latest`,
    );
  });

  // npm applies every field of the package.json it reads (publishConfig as
  // npm config, `tag`, ...), so any byte of difference must be refused.
  const parsed = JSON.parse(trusted) as Record<string, unknown>;
  const rejectedManifests: [string, string][] = [
    ["another package's name", JSON.stringify({ ...parsed, name: "@pound79/other" }, null, 2)],
    ["a different version", JSON.stringify({ ...parsed, version: "9.9.9" }, null, 2)],
    ["publishConfig that redirects npm's network settings", evil],
    [
      "publishConfig that sets the scoped registry",
      JSON.stringify(
        {
          ...parsed,
          publishConfig: { access: "public", "@pound79:registry": "https://registry.invalid/" },
        },
        null,
        2,
      ),
    ],
    ["a top-level tag", JSON.stringify({ ...parsed, tag: "latest" }, null, 2)],
    ["only whitespace changed", JSON.stringify(parsed)],
    [
      "only key order changed",
      JSON.stringify(
        { version: parsed.version, name: parsed.name, publishConfig: parsed.publishConfig },
        null,
        2,
      ),
    ],
  ];

  it.each(rejectedManifests)("refuses a package.json with %s", (_, body) => {
    const result = publishWith(tgz([{ name: "package/package.json", body }]));
    expect(result.status).not.toBe(0);
    expect(published(result)).toBe(false);
    expect(result.output).toMatch(/refusing to publish/);
  });

  // npm unpacks the tarball with the first path component stripped and reads
  // the resulting package.json (the last one written wins); these layouts make
  // it read a different one than a naive listing suggests.
  const rejectedLayouts: [string, Entry[] | ((root: string) => Entry[])][] = [
    [
      "a second package.json under another top-level directory",
      [
        { name: "package/package.json", body: trusted },
        { name: "evil/package.json", body: evil },
      ],
    ],
    [
      "a duplicate package/package.json entry",
      [
        { name: "package/package.json", body: trusted },
        { name: "package/package.json", body: evil },
      ],
    ],
    [
      "a second package/package.json hidden behind a lone zero block",
      [
        { name: "package/package.json", body: trusted },
        "lone zero block",
        { name: "package/package.json", body: evil },
      ],
    ],
    [
      "a package.json under package//",
      [
        { name: "package/package.json", body: trusted },
        { name: "package//package.json", body: evil },
      ],
    ],
    ["only a package.json under another directory", [{ name: "zzz/package.json", body: evil }]],
    [
      "a symlinked package.json",
      [{ name: "package/package.json", type: "2", linkname: "../outside.json" }],
    ],
    // npm's prepare follows `.git/HEAD` in the extracted tree and reads the
    // referenced file — anywhere on the runner — into the published gitHead.
    [
      ".git/HEAD referring to a file outside the tarball",
      (root) => {
        writeFileSync(path.join(root, "secret"), "runner secret\n");
        return [
          { name: "package/package.json", body: trusted },
          { name: "package/.git/HEAD", body: `ref: ${path.join(root, "secret")}\n` },
        ];
      },
    ],
    [
      ".git/HEAD holding a commit hash",
      [
        { name: "package/package.json", body: trusted },
        { name: "package/.git/HEAD", body: `${"a".repeat(40)}\n` },
      ],
    ],
  ];

  it.each(rejectedLayouts)("refuses a tarball with %s", (_, entries) => {
    const result = publishWith((root) =>
      tgz(typeof entries === "function" ? entries(root) : entries),
    );
    expect(result.status).not.toBe(0);
    expect(published(result)).toBe(false);
    expect(result.output).toMatch(/refusing to publish/);
  });

  // The check governs what npm reads as the manifest and as config. Other
  // contents are what gets published: tampering with them in the build job is
  // out of scope (see RELEASING.md), and pacote itself drops links and paths
  // outside its extraction directory. So these are accepted on purpose.
  const acceptedLayouts: [string, Entry[]][] = [
    ["a file name with a control byte", [{ name: "package/a\tb.js", body: "" }]],
    [
      "a hardlink entry",
      [{ name: "package/other.json", type: "1", linkname: "package/package.json" }],
    ],
    ["a directory entry", [{ name: "package/lib/", type: "5" }]],
    [
      ".npmrc outside package/",
      [{ name: ".npmrc", body: "https-proxy=http://proxy.invalid:8080\n" }],
    ],
    ["a path with a .. segment", [{ name: "package/../escape.json", body: "{}" }]],
  ];

  it.each(acceptedLayouts)("accepts a tarball with %s", (_, extra) => {
    const result = publishWith(validTarball(pkg, extra));
    expect(result.status, result.output).toBe(0);
    expect(published(result)).toBe(true);
  });

  it("detects a publish step that no longer runs the tarball check", () => {
    const withoutCheck = run.replace(/^.*verify-publish-tarball\.sh.*\n/m, "");
    expect(withoutCheck).not.toBe(run);
    const bypass = tgz([{ name: "package/package.json", body: evil }]);
    expect(
      published(runSteps([withoutCheck], { ...validArtifact(), [pkg.tarball(VERSION)]: bypass })),
    ).toBe(true);
  });
});

describe("release publish artifact check", STEP_TEST_OPTIONS, () => {
  const run = stepRun("Verify the downloaded artifact");

  it("accepts exactly the two expected tarballs", () => {
    const result = runSteps([run], validArtifact());
    expect(result.status, result.output).toBe(0);
  });

  // npm reads `.npmrc` from the directory it runs in when no package.json is
  // found above it, so nothing but the two tarballs may be in that directory.
  const rejected: [string, Record<string, Buffer | string>][] = [
    [
      "an extra .npmrc",
      { ...validArtifact(), ".npmrc": "https-proxy=http://proxy.invalid:8080\n" },
    ],
    ["an extra package.json", { ...validArtifact(), "package.json": "{}" }],
    ["an extra tarball", { ...validArtifact(), "x-1.0.0.tgz": validTarball(PACKAGES[0]) }],
    ["a missing tarball", { [PACKAGES[0].tarball(VERSION)]: validTarball(PACKAGES[0]) }],
  ];

  it.each(rejected)("refuses a directory with %s", (_, files) => {
    const result = runSteps([run, stepRun(`Publish ${PACKAGES[1].name}`)], files);
    expect(result.status).not.toBe(0);
    expect(published(result)).toBe(false);
    expect(result.output).toMatch(/refusing to publish/);
  });

  it("is a step of its own that runs before any publish step", () => {
    const names = publishJob.steps.map((step) => step.name);
    const check = names.indexOf("Verify the downloaded artifact");
    expect(check).toBeGreaterThanOrEqual(0);
    for (const pkg of PACKAGES) {
      expect(check).toBeLessThan(names.indexOf(`Publish ${pkg.name}`));
    }
  });
});
