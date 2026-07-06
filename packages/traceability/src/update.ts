import {
  computeFileHash,
  computeHeadingSectionHash,
  FILE_MISSING,
  SECTION_MISSING,
} from './hash.js';
import {
  loadManifest,
  saveManifest,
  type FileRef,
  type SpecRef,
  type TraceabilityLink,
  type TraceabilityManifest,
} from './manifest.js';
import { resolveWithinRoot } from './resolve.js';
import type { DriftSide } from './check.js';

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
  repoRoot: string
): Promise<RefreshResult<SpecRef>> => {
  const hash = await computeHeadingSectionHash(
    resolveWithinRoot(repoRoot, ref.path),
    ref.heading,
    ref.headingLevel
  );
  if (hash === FILE_MISSING || hash === SECTION_MISSING) {
    throw new Error(
      `Cannot update link "${linkId}": ${hash} for ${ref.path} (heading: ${ref.heading}). ` +
        'Fix the manifest entry instead of blessing a missing reference.'
    );
  }
  if (hash === ref.hash) {
    return { ref, change: null };
  }
  return {
    ref: { ...ref, hash },
    change: {
      linkId,
      side: 'spec',
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
  side: Extract<DriftSide, 'impl' | 'feature'>
): Promise<RefreshResult<FileRef>> => {
  const hash = await computeFileHash(resolveWithinRoot(repoRoot, ref.path));
  if (hash === FILE_MISSING) {
    throw new Error(
      `Cannot update link "${linkId}": file missing: ${ref.path}. ` +
        'Fix the manifest entry instead of blessing a missing reference.'
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

const isChange = (change: UpdateChange | null): change is UpdateChange =>
  change !== null;

const refreshLink = async (
  link: TraceabilityLink,
  repoRoot: string
): Promise<{ link: TraceabilityLink; changes: UpdateChange[] }> => {
  const specResults = await Promise.all(
    link.spec.map((ref) => refreshSpecRef(ref, link.id, repoRoot))
  );
  const implResults = await Promise.all(
    link.impl.map((ref) => refreshFileRef(ref, link.id, repoRoot, 'impl'))
  );
  const featureResults = await Promise.all(
    link.features.map((ref) =>
      refreshFileRef(ref, link.id, repoRoot, 'feature')
    )
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
   *  stored hashes are left untouched. The manifest file itself is still fully
   *  rewritten by saveManifest — this only confines hash *churn* to one link,
   *  so concurrent feature branches don't conflict on each other's hashes. */
  linkId?: string;
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
  manifestPath: string,
  repoRoot: string,
  options: UpdateOptions = {}
): Promise<UpdateResult> => {
  const manifest = await loadManifest(manifestPath);
  const { linkId, dryRun = false } = options;
  if (
    linkId !== undefined &&
    !manifest.links.some((link) => link.id === linkId)
  ) {
    throw new Error(
      `Cannot update: no link with id "${linkId}" in the manifest.`
    );
  }
  const results = await Promise.all(
    manifest.links.map((link) =>
      linkId === undefined || link.id === linkId
        ? refreshLink(link, repoRoot)
        : Promise.resolve({ link, changes: [] as UpdateChange[] })
    )
  );
  const updated: TraceabilityManifest = {
    ...manifest,
    links: results.map((result) => result.link),
  };
  if (!dryRun) {
    await saveManifest(manifestPath, updated);
  }
  return { ...updated, changes: results.flatMap((result) => result.changes) };
};
