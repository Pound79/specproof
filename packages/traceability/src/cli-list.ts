#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { resolveWithinRoot } from "./resolve.js";
import { buildDomainList, formatDomainList } from "./list.js";
import { loadManifest } from "./manifest.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";
import { printJson, printText } from "./output.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root, pagesDir, candidateSuffix } = parseCliArgs(
    process.argv.slice(2),
    "list",
  );
  const config = discoverConfig({ manifest, root, pagesDir, candidateSuffix });
  const loaded = await loadManifest(config.manifestPath);

  // Candidate discovery only runs when a pages directory is configured;
  // without it the report shows registered domains and an empty candidate list.
  let pageFileNames: string[] = [];
  if (config.pagesDir) {
    const dirents = await readdir(resolveWithinRoot(config.repoRoot, config.pagesDir), {
      withFileTypes: true,
    });
    pageFileNames = dirents.filter((dirent) => dirent.isFile()).map((dirent) => dirent.name);
  }

  const domainList = buildDomainList(loaded, pageFileNames, {
    pagesDir: config.pagesDir,
    candidateSuffix: config.candidateSuffix,
  });

  if (flags.has("--json")) {
    printJson(domainList);
    return;
  }

  printText(formatDomainList(domainList));
};

runCli("traceability list", main);
