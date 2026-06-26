import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  computeFileHash,
  computeHeadingSectionHash,
  containsDraftMarker,
  DRAFT_MARKER,
  FILE_MISSING,
  readFileOrNull,
  SECTION_MISSING,
} from './hash.js';
import { parseScenarios, type ScannedScenario } from './feature-scan.js';
import {
  loadManifest,
  type TraceabilityLink,
  type TraceabilityManifest,
} from './manifest.js';
import { resolveWithinRoot } from './resolve.js';
import { DEFAULT_FIXME_TAG, DEFAULT_SKIP_TAG } from './config.js';

export type DriftSide = 'spec' | 'impl' | 'feature';

export interface DriftEntry {
  linkId: string;
  side: DriftSide;
  path: string;
  heading?: string;
  storedHash: string;
  currentHash: string;
  status: 'changed' | 'missing';
}

export interface DriftWarning {
  // Present for a warning tied to a manifest link (empty-link, or a draft marker
  // on a registered feature). Absent for an unregistered featuresDir file.
  linkId?: string;
  kind: 'empty-link' | 'unreviewed-draft' | 'missing-skip-reason';
  // The offending file path (the feature, for unreviewed-draft). Absent for
  // empty-link, where the link itself — not a file — is the subject.
  path?: string;
  message: string;
}

export interface DriftReport {
  clean: boolean;
  // Number of drifted ref entries. A single link can contribute several
  // (e.g. both its impl and a feature changed), so driftCount >= driftLinkCount.
  driftCount: number;
  // Number of distinct links that have at least one drifted ref.
  driftLinkCount: number;
  entries: DriftEntry[];
  // Non-drift structural advisories (e.g. a link that tracks nothing). Always
  // surfaced; escalated to a failing exit code under `--strict`.
  warnings: DriftWarning[];
}

const isSentinel = (hash: string): boolean =>
  hash === FILE_MISSING || hash === SECTION_MISSING;

const statusFor = (currentHash: string): DriftEntry['status'] =>
  isSentinel(currentHash) ? 'missing' : 'changed';

// A missing file/section must always be reported, even when the stored hash is
// already the same sentinel (e.g. a hand-edited manifest). Only a matching
// real digest counts as clean.
const isClean = (storedHash: string, currentHash: string): boolean =>
  storedHash === currentHash && !isSentinel(currentHash);

const checkLink = async (
  link: TraceabilityLink,
  repoRoot: string
): Promise<DriftEntry[]> => {
  const specEntries = await Promise.all(
    link.spec.map(async (ref): Promise<DriftEntry | null> => {
      const currentHash = await computeHeadingSectionHash(
        resolveWithinRoot(repoRoot, ref.path),
        ref.heading,
        ref.headingLevel
      );
      if (isClean(ref.hash, currentHash)) {
        return null;
      }
      return {
        linkId: link.id,
        side: 'spec',
        path: ref.path,
        heading: ref.heading,
        storedHash: ref.hash,
        currentHash,
        status: statusFor(currentHash),
      };
    })
  );

  const fileEntries = await Promise.all(
    [
      ...link.impl.map((ref) => ({ ref, side: 'impl' as const })),
      ...link.features.map((ref) => ({ ref, side: 'feature' as const })),
    ].map(async ({ ref, side }): Promise<DriftEntry | null> => {
      const currentHash = await computeFileHash(
        resolveWithinRoot(repoRoot, ref.path)
      );
      if (isClean(ref.hash, currentHash)) {
        return null;
      }
      return {
        linkId: link.id,
        side,
        path: ref.path,
        storedHash: ref.hash,
        currentHash,
        status: statusFor(currentHash),
      };
    })
  );

  return [...specEntries, ...fileEntries].filter(
    (entry): entry is DriftEntry => entry !== null
  );
};

// A link that tracks nothing on all three sides is structurally meaningless
// (a partially-built or corrupted entry) and would otherwise report "clean".
const isEmptyLink = (link: TraceabilityLink): boolean =>
  link.spec.length === 0 &&
  link.impl.length === 0 &&
  link.features.length === 0;

const emptyLinkWarning = (link: TraceabilityLink): DriftWarning => ({
  linkId: link.id,
  kind: 'empty-link',
  message: `link "${link.id}" tracks nothing (spec, impl and features are all empty)`,
});

const unreviewedDraftWarning = (
  featurePath: string,
  linkId?: string
): DriftWarning => {
  const message = `feature "${featurePath}" still carries the bdd-kit draft marker ("${DRAFT_MARKER}") — review and remove it before implementing (unreviewed bootstrap draft)`;
  return linkId === undefined
    ? { kind: 'unreviewed-draft', path: featurePath, message }
    : { linkId, kind: 'unreviewed-draft', path: featurePath, message };
};

// Tags whose scenarios must carry a one-line reason comment (the methodology
// mandate), in priority order — the first match names the warning. Canonical
// defaults; repos that rename these via `tags.fixme` / `tags.skip` pass their
// own values through CheckDriftOptions.reasonRequiredTags.
const DEFAULT_REASON_REQUIRED_TAGS = [DEFAULT_FIXME_TAG, DEFAULT_SKIP_TAG];

const missingSkipReasonWarning = (
  featurePath: string,
  scenario: ScannedScenario,
  tag: string,
  linkId?: string
): DriftWarning => {
  const message = `scenario "${scenario.name}" (${featurePath}:${scenario.line}) is tagged ${tag} without a reason comment — add a "# ..." line above it stating why it is not automated`;
  return linkId === undefined
    ? { kind: 'missing-skip-reason', path: featurePath, message }
    : { linkId, kind: 'missing-skip-reason', path: featurePath, message };
};

// A feature file to lint, with its manifest link id when it is registered.
interface FeatureTarget {
  relPath: string;
  linkId?: string;
}

// The full set of feature files to lint: every manifest-registered feature plus
// every *.feature physically under featuresDir (so an unregistered draft copied
// in is still caught — the ADR 0004 / bdd-bootstrap promise). Deduped by repo-
// relative path; the registered entry (which carries a linkId) wins.
const collectFeatureTargets = async (
  manifest: TraceabilityManifest,
  repoRoot: string,
  featuresDir: string | undefined
): Promise<FeatureTarget[]> => {
  const registered: FeatureTarget[] = manifest.links.flatMap((link) =>
    link.features.map((ref) => ({
      relPath: path.posix.normalize(ref.path),
      linkId: link.id,
    }))
  );
  const seen = new Set(registered.map((target) => target.relPath));

  if (featuresDir === undefined) {
    return registered;
  }
  const absFeaturesDir = resolveWithinRoot(repoRoot, featuresDir);
  let entries: string[];
  try {
    entries = await readdir(absFeaturesDir, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return registered;
    }
    throw error;
  }
  const scanned: FeatureTarget[] = entries
    .filter((entry) => entry.endsWith('.feature'))
    .map((entry) => path.posix.join(featuresDir, entry.split(path.sep).join('/')))
    .filter((relPath) => !seen.has(relPath))
    .map((relPath) => ({ relPath }));

  return [...registered, ...scanned];
};

// Reads a feature file once and runs every content lint on it (draft marker +
// skip/fixme reason comments). Missing files are left to drift detection.
const lintFeature = async (
  target: FeatureTarget,
  repoRoot: string,
  reasonRequiredTags: string[]
): Promise<DriftWarning[]> => {
  const content = await readFileOrNull(
    resolveWithinRoot(repoRoot, target.relPath)
  );
  if (content === null) {
    return [];
  }
  const warnings: DriftWarning[] = [];
  if (containsDraftMarker(content)) {
    warnings.push(unreviewedDraftWarning(target.relPath, target.linkId));
  }
  for (const scenario of parseScenarios(content)) {
    const tag = reasonRequiredTags.find((required) =>
      scenario.tags.includes(required)
    );
    if (tag !== undefined && !scenario.hasReasonComment) {
      warnings.push(
        missingSkipReasonWarning(target.relPath, scenario, tag, target.linkId)
      );
    }
  }
  return warnings;
};

export interface CheckDriftOptions {
  /** Repo-relative features dir. When set, every *.feature in it is linted for
   *  the draft marker and skip/fixme reason comments — catching files copied in
   *  but not registered in the manifest. */
  featuresDir?: string;
  /** Tags whose scenarios must carry a reason comment, in priority order (the
   *  first match names the warning). Defaults to ["@fixme", "@skip"]; pass the
   *  repo's `tags.fixme` / `tags.skip` to honour a custom tag taxonomy. */
  reasonRequiredTags?: string[];
}

export const checkDrift = async (
  manifestPath: string,
  repoRoot: string,
  options: CheckDriftOptions = {}
): Promise<DriftReport> => {
  const reasonRequiredTags =
    options.reasonRequiredTags ?? DEFAULT_REASON_REQUIRED_TAGS;
  const manifest = await loadManifest(manifestPath);
  const entriesPerLink = await Promise.all(
    manifest.links.map((link) => checkLink(link, repoRoot))
  );
  const entries = entriesPerLink.flat();
  const driftLinkCount = new Set(entries.map((entry) => entry.linkId)).size;

  const targets = await collectFeatureTargets(
    manifest,
    repoRoot,
    options.featuresDir
  );
  const featureWarningGroups = await Promise.all(
    targets.map((target) => lintFeature(target, repoRoot, reasonRequiredTags))
  );

  const warnings = [
    ...manifest.links.filter(isEmptyLink).map(emptyLinkWarning),
    ...featureWarningGroups.flat(),
  ];
  return {
    clean: entries.length === 0,
    driftCount: entries.length,
    driftLinkCount,
    entries,
    warnings,
  };
};
