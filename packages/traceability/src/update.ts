import {
  computeFileHash,
  computeHeadingSectionHash,
  FILE_MISSING,
  SECTION_MISSING,
} from "./hash.js";
import {
  loadManifest,
  saveManifest,
  type FileRef,
  type SpecRef,
  type TraceabilityLink,
  type TraceabilityManifest,
} from "./manifest.js";
import path from "node:path";
import { resolveWithinRoot } from "./resolve.js";
import type { DriftSide } from "./check.js";
import { createTaskLimiter, type RunTaskLimited } from "./concurrency.js";

const MAX_CONCURRENT_FILE_READS = 32;

export interface UpdateChange {
  linkId: string;
  side: DriftSide;
  path: string;
  heading?: string;
  oldHash: string;
  newHash: string;
}

interface RefreshResult<Ref> {
  ref: Ref;
  change: UpdateChange | null;
}

const refreshSpecRef = async (
  ref: SpecRef,
  linkId: string,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<RefreshResult<SpecRef>> => {
  const hash = await runLimited(() =>
    computeHeadingSectionHash(resolveWithinRoot(repoRoot, ref.path), ref.heading, ref.headingLevel),
  );
  if (hash === FILE_MISSING || hash === SECTION_MISSING) {
    throw new Error(
      `Cannot update link "${linkId}": ${hash} for ${ref.path} (heading: ${ref.heading}). ` +
        "Fix the manifest entry instead of blessing a missing reference.",
    );
  }
  if (hash === ref.hash) {
    return { ref, change: null };
  }
  return {
    ref: { ...ref, hash },
    change: {
      linkId,
      side: "spec",
      path: ref.path,
      heading: ref.heading,
      oldHash: ref.hash,
      newHash: hash,
    },
  };
};

const refreshFileRef = async (
  ref: FileRef,
  linkId: string,
  repoRoot: string,
  side: Extract<DriftSide, "impl" | "feature">,
  runLimited: RunTaskLimited,
): Promise<RefreshResult<FileRef>> => {
  const hash = await runLimited(() => computeFileHash(resolveWithinRoot(repoRoot, ref.path)));
  if (hash === FILE_MISSING) {
    throw new Error(
      `Cannot update link "${linkId}": file missing: ${ref.path}. ` +
        "Fix the manifest entry instead of blessing a missing reference.",
    );
  }
  if (hash === ref.hash) {
    return { ref, change: null };
  }
  return {
    ref: { ...ref, hash },
    change: { linkId, side, path: ref.path, oldHash: ref.hash, newHash: hash },
  };
};

const isChange = (change: UpdateChange | null): change is UpdateChange => change !== null;

const refreshLink = async (
  link: TraceabilityLink,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<{ link: TraceabilityLink; changes: UpdateChange[] }> => {
  const specResults = await Promise.all(
    link.spec.map((ref) => refreshSpecRef(ref, link.id, repoRoot, runLimited)),
  );
  const implResults = await Promise.all(
    link.impl.map((ref) => refreshFileRef(ref, link.id, repoRoot, "impl", runLimited)),
  );
  const featureResults = await Promise.all(
    link.features.map((ref) => refreshFileRef(ref, link.id, repoRoot, "feature", runLimited)),
  );

  return {
    link: {
      ...link,
      spec: specResults.map((result) => result.ref),
      impl: implResults.map((result) => result.ref),
      features: featureResults.map((result) => result.ref),
    },
    changes: [
      ...specResults.map((result) => result.change),
      ...implResults.map((result) => result.change),
      ...featureResults.map((result) => result.change),
    ].filter(isChange),
  };
};

export interface UpdateOptions {
  /** When set, only the link with this id is re-hashed; every other link's
   *  stored hashes are left untouched. Only changed hash scalars are replaced;
   *  comments and unrelated text are preserved. A no-op never writes the file. */
  linkId?: string;
  /** Like `linkId`, for several links at once. Combined with `linkId` as one
   *  set. Every id must exist in the manifest, or nothing is written. An empty
   *  array is an error (not "every link"): a caller that filtered the ids down
   *  to none must not bless the drift it did not review. Omit it to update all. */
  linkIds?: readonly string[];
  /** Compute (and return) the same changes as a normal run, but never write
   *  the manifest file. Sentinel rejection (FILE_MISSING / SECTION_MISSING)
   *  still throws in dry-run — a dry run previews hash churn, it does not
   *  relax the "never bless a missing reference" invariant. */
  dryRun?: boolean;
}

export interface UpdateResult extends TraceabilityManifest {
  /** Every ref whose hash actually changed in this run, in manifest order.
   *  Empty when nothing changed (including a dry run that found no drift). */
  changes: UpdateChange[];
}

export const updateManifestHashes = async (
  requestedManifestPath: string,
  repoRoot: string,
  options: UpdateOptions = {},
): Promise<UpdateResult> => {
  // saveManifest は最終要素のリンクを辿って書くため、公開 API の入口でも
  // manifest とそのリンク先が repo 内にあることを確かめる（相対パスは従来どおり cwd 基準）。
  const manifestPath = resolveWithinRoot(repoRoot, path.resolve(requestedManifestPath));
  const manifest = await loadManifest(manifestPath);
  const runLimited = createTaskLimiter(MAX_CONCURRENT_FILE_READS);
  const { dryRun = false } = options;
  const requested = [
    ...new Set([
      ...(options.linkId === undefined ? [] : [options.linkId]),
      ...(options.linkIds ?? []),
    ]),
  ];
  if (options.linkIds !== undefined && requested.length === 0) {
    throw new Error("Cannot update: linkIds is empty; omit it to update every link.");
  }
  const known = new Set(manifest.links.map((link) => link.id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    const ids = unknown.map((id) => JSON.stringify(id)).join(", ");
    throw new Error(`Cannot update: no link with id ${ids} in the manifest.`);
  }
  const selected = requested.length === 0 ? undefined : new Set(requested);
  const results = await Promise.all(
    manifest.links.map((link) =>
      selected === undefined || selected.has(link.id)
        ? refreshLink(link, repoRoot, runLimited)
        : Promise.resolve({ link, changes: [] as UpdateChange[] }),
    ),
  );
  const updated: TraceabilityManifest = {
    ...manifest,
    links: results.map((result) => result.link),
  };
  const changes = results.flatMap((result) => result.changes);
  if (!dryRun && changes.length > 0) {
    await saveManifest(manifestPath, updated, manifest, repoRoot);
  }
  return { ...updated, changes };
};
