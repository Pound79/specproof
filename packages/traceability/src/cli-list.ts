#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { buildDomainList, formatDomainList } from "./list.js";
import { loadManifest } from "./manifest.js";
import { discoverConfig } from "./config.js";
import { parseCliArgs, runCli } from "./cli-args.js";

const main = async (): Promise<void> => {
  const { flags, manifest, root, pagesDir, candidateSuffix } = parseCliArgs(
    process.argv.slice(2),
  );
  const config = discoverConfig({ manifest, root, pagesDir, candidateSuffix });
  const loaded = await loadManifest(config.manifestPath);

  // Candidate discovery only runs when a pages directory is configured;
  // without it the report shows registered domains and an empty candidate list.
  let pageFileNames: string[] = [];
  if (config.pagesDir) {
    const dirents = await readdir(path.join(config.repoRoot, config.pagesDir), {
      withFileTypes: true,
    });
    pageFileNames = dirents
      .filter((dirent) => dirent.isFile())
      .map((dirent) => dirent.name);
  }

  const domainList = buildDomainList(loaded, pageFileNames, {
    pagesDir: config.pagesDir,
    candidateSuffix: config.candidateSuffix,
  });

  if (flags.has("--json")) {
    console.log(JSON.stringify(domainList, null, 2));
    return;
  }

  console.log(formatDomainList(domainList));
};

runCli("traceability list", main);
