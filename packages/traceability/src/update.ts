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

const refreshSpecRef = async (
  ref: SpecRef,
  linkId: string,
  repoRoot: string
): Promise<SpecRef> => {
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
  return { ...ref, hash };
};

const refreshFileRef = async (
  ref: FileRef,
  linkId: string,
  repoRoot: string
): Promise<FileRef> => {
  const hash = await computeFileHash(resolveWithinRoot(repoRoot, ref.path));
  if (hash === FILE_MISSING) {
    throw new Error(
      `Cannot update link "${linkId}": file missing: ${ref.path}. ` +
        'Fix the manifest entry instead of blessing a missing reference.'
    );
  }
  return { ...ref, hash };
};

const refreshLink = async (
  link: TraceabilityLink,
  repoRoot: string
): Promise<TraceabilityLink> => ({
  ...link,
  spec: await Promise.all(
    link.spec.map((ref) => refreshSpecRef(ref, link.id, repoRoot))
  ),
  impl: await Promise.all(
    link.impl.map((ref) => refreshFileRef(ref, link.id, repoRoot))
  ),
  features: await Promise.all(
    link.features.map((ref) => refreshFileRef(ref, link.id, repoRoot))
  ),
});

export interface UpdateOptions {
  /** When set, only the link with this id is re-hashed; every other link's
   *  stored hashes are left untouched. The manifest file itself is still fully
   *  rewritten by saveManifest — this only confines hash *churn* to one link,
   *  so concurrent feature branches don't conflict on each other's hashes. */
  linkId?: string;
}

export const updateManifestHashes = async (
  manifestPath: string,
  repoRoot: string,
  options: UpdateOptions = {}
): Promise<TraceabilityManifest> => {
  const manifest = await loadManifest(manifestPath);
  const { linkId } = options;
  if (
    linkId !== undefined &&
    !manifest.links.some((link) => link.id === linkId)
  ) {
    throw new Error(
      `Cannot update: no link with id "${linkId}" in the manifest.`
    );
  }
  const updated: TraceabilityManifest = {
    ...manifest,
    links: await Promise.all(
      manifest.links.map((link) =>
        linkId === undefined || link.id === linkId
          ? refreshLink(link, repoRoot)
          : Promise.resolve(link)
      )
    ),
  };
  await saveManifest(manifestPath, updated);
  return updated;
};
