import { findFeatureFiles } from "./feature-files.js";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  computeFileHash,
  computeHeadingSectionHash,
  containsDraftMarker,
  DRAFT_MARKER,
  FILE_MISSING,
  readFileOrNull,
  SECTION_MISSING,
} from "./hash.js";
import { parseFeatureScenarios, type ScannedScenario } from "./feature-scan.js";
import { loadManifest, type TraceabilityLink, type TraceabilityManifest } from "./manifest.js";
import { resolveWithinRoot } from "./resolve.js";
import { OUT_OF_SCOPE_TAG, RETIRED_TAGS } from "./config.js";
import { auditUnregisteredImpl } from "./impl-audit.js";
import { auditSpecHeadings } from "./spec-audit.js";
import { lintFeatureSet, type FeatureLintKind, type FeatureSource } from "./feature-lint.js";
import { createTaskLimiter, type RunTaskLimited } from "./concurrency.js";

const MAX_CONCURRENT_FILE_READS = 32;

export type DriftSide = "spec" | "impl" | "feature";

export interface DriftEntry {
  linkId: string;
  side: DriftSide;
  path: string;
  heading?: string;
  storedHash: string;
  currentHash: string;
  status: "changed" | "missing";
}

export interface DriftWarning {
  // Present for a warning tied to a manifest link (empty-link, a draft marker
  // on a registered feature, or duplicate-heading). Absent for an
  // unregistered file/heading, which has no link to attach to.
  linkId?: string;
  kind:
    | "empty-link"
    | "unreviewed-draft"
    | "missing-reason"
    | "retired-tag"
    | "unregistered-feature"
    | "unregistered-spec-heading"
    | "unregistered-impl"
    | "duplicate-heading"
    | FeatureLintKind;
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
  // linkIds where both a spec ref and an impl ref drifted in the same run —
  // the situation specproof-sync must never auto-resolve (H3): it cannot tell
  // which side is authoritative, so it must stop and ask a human. Always
  // present (empty when there is no such link).
  bothSidesChanged: string[];
}

const isSentinel = (hash: string): boolean => hash === FILE_MISSING || hash === SECTION_MISSING;

const statusFor = (currentHash: string): DriftEntry["status"] =>
  isSentinel(currentHash) ? "missing" : "changed";

// A missing file/section must always be reported, even when the stored hash is
// already the same sentinel (e.g. a hand-edited manifest). Only a matching
// real digest counts as clean.
const isClean = (storedHash: string, currentHash: string): boolean =>
  storedHash === currentHash && !isSentinel(currentHash);

const checkLink = async (
  link: TraceabilityLink,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<DriftEntry[]> => {
  const specEntries = await Promise.all(
    link.spec.map(async (ref): Promise<DriftEntry | null> => {
      const currentHash = await runLimited(() =>
        computeHeadingSectionHash(
          resolveWithinRoot(repoRoot, ref.path),
          ref.heading,
          ref.headingLevel,
        ),
      );
      if (isClean(ref.hash, currentHash)) {
        return null;
      }
      return {
        linkId: link.id,
        side: "spec",
        path: ref.path,
        heading: ref.heading,
        storedHash: ref.hash,
        currentHash,
        status: statusFor(currentHash),
      };
    }),
  );

  const fileEntries = await Promise.all(
    [
      ...link.impl.map((ref) => ({ ref, side: "impl" as const })),
      ...link.features.map((ref) => ({ ref, side: "feature" as const })),
    ].map(async ({ ref, side }): Promise<DriftEntry | null> => {
      const currentHash = await runLimited(() =>
        computeFileHash(resolveWithinRoot(repoRoot, ref.path)),
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
    }),
  );

  return [...specEntries, ...fileEntries].filter((entry): entry is DriftEntry => entry !== null);
};

// A link that tracks nothing on all three sides is structurally meaningless
// (a partially-built or corrupted entry) and would otherwise report "clean".
const isEmptyLink = (link: TraceabilityLink): boolean =>
  link.spec.length === 0 && link.impl.length === 0 && link.features.length === 0;

const emptyLinkWarning = (link: TraceabilityLink): DriftWarning => ({
  linkId: link.id,
  kind: "empty-link",
  message: `link "${link.id}" tracks nothing (spec, impl and features are all empty)`,
});

const unreviewedDraftWarning = (featurePath: string, linkId?: string): DriftWarning => {
  const message = `feature "${featurePath}" still carries the specproof draft marker ("${DRAFT_MARKER}") — review and remove it before implementing (unreviewed bootstrap draft)`;
  return linkId === undefined
    ? { kind: "unreviewed-draft", path: featurePath, message }
    : { linkId, kind: "unreviewed-draft", path: featurePath, message };
};

const withLink = (warning: DriftWarning, linkId?: string): DriftWarning =>
  linkId === undefined ? warning : { linkId, ...warning };

// @out-of-scope は受け入れ条件から外す宣言なので、なぜ外すかの 1 行コメントを必須にする。
const missingReasonWarning = (
  featurePath: string,
  scenario: ScannedScenario,
  inherited: boolean,
  linkId?: string,
): DriftWarning =>
  withLink(
    {
      kind: "missing-reason",
      path: featurePath,
      message: inherited
        ? `scenario "${scenario.name}" (${featurePath}:${scenario.line}) inherits ${OUT_OF_SCOPE_TAG} from its Feature / Rule / Examples — put ${OUT_OF_SCOPE_TAG} on each scenario with a "# ..." reason line above it`
        : `scenario "${scenario.name}" (${featurePath}:${scenario.line}) is tagged ${OUT_OF_SCOPE_TAG} without a reason comment — add a "# ..." line above it stating why it is excluded`,
    },
    linkId,
  );

// 退役した @fixme / @skip。runner が黙って実行しないので、残すと条件が確かめられないまま残る。
const retiredTagWarning = (
  featurePath: string,
  scenario: ScannedScenario,
  tag: string,
  linkId?: string,
): DriftWarning =>
  withLink(
    {
      kind: "retired-tag",
      path: featurePath,
      message: `scenario "${scenario.name}" (${featurePath}:${scenario.line}) carries the retired tag ${tag} — remove it and use @red-contract (not implemented yet), @human (checked by a person) or ${OUT_OF_SCOPE_TAG} (excluded, with a reason comment)`,
    },
    linkId,
  );

// A-1: a *.feature file physically present under featuresDir that no link's
// features[] registers. No linkId — there is no link to attach the warning to.
const unregisteredFeatureWarning = (relPath: string): DriftWarning => ({
  kind: "unregistered-feature",
  path: relPath,
  message: `feature file is not registered in the traceability manifest: ${relPath}`,
});

// A feature file to lint, with its manifest link id when it is registered.
interface FeatureTarget {
  relPath: string;
  linkId?: string;
}

// The full set of feature files to lint: every manifest-registered feature plus
// every *.feature physically under featuresDir (so an unregistered draft copied
// in is still caught — the ADR 0004 / specproof-bootstrap promise). Deduped by
// repo-relative path; the registered entry (which carries a linkId) wins.
const collectFeatureTargets = async (
  manifest: TraceabilityManifest,
  repoRoot: string,
  featuresDir: string | undefined,
): Promise<FeatureTarget[]> => {
  const registered: FeatureTarget[] = manifest.links.flatMap((link) =>
    link.features.map((ref) => ({
      relPath: path.posix.normalize(ref.path),
      linkId: link.id,
    })),
  );
  const seen = new Set(registered.map((target) => target.relPath));

  if (featuresDir === undefined) {
    return registered;
  }
  let entries: string[];
  try {
    entries = await findFeatureFiles(repoRoot, featuresDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return registered;
    }
    throw error;
  }
  // 探索は実体で重複を除いた代表パスを返すので、登録済みかどうかも実体で照合する。
  // 論理パスだけで比べると、登録済み feature への別名リンクを未登録と誤判定する。
  const registeredReal = new Set(
    registered.map((target) => realpathOrUndefined(repoRoot, target.relPath)).filter(Boolean),
  );
  const scanned: FeatureTarget[] = entries
    .filter((relPath) => !seen.has(relPath))
    .filter((relPath) => !registeredReal.has(realpathOrUndefined(repoRoot, relPath)))
    .map((relPath) => ({ relPath }));

  return [...registered, ...scanned];
};

/** repo 内で解決できるファイルの実体パス。欠落や repo 外は undefined（照合しない）。 */
const realpathOrUndefined = (repoRoot: string, relPath: string): string | undefined => {
  try {
    return realpathSync(resolveWithinRoot(repoRoot, relPath));
  } catch {
    return undefined;
  }
};

// Reads a feature file once and runs the per-file lints on it (draft marker +
// skip/fixme reason comments). Returns the content too, so the cross-file
// feature lint can compare scenarios. Missing files are left to drift detection.
const lintFeature = async (
  target: FeatureTarget,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<{ warnings: DriftWarning[]; source?: FeatureSource }> => {
  const content = await runLimited(() =>
    readFileOrNull(resolveWithinRoot(repoRoot, target.relPath)),
  );
  if (content === null) {
    return { warnings: [] };
  }
  const warnings: DriftWarning[] = [];
  if (containsDraftMarker(content)) {
    warnings.push(unreviewedDraftWarning(target.relPath, target.linkId));
  }
  for (const scenario of parseFeatureScenarios(target.relPath, content)) {
    // @out-of-scope はシナリオ自身に付け、その直前に理由を書く。Feature / Rule / Examples から
    // 継承した宣言は、理由の置き場所が定まらず一括で外せてしまうので、理由があっても警告する。
    const ownOutOfScope = scenario.tags.includes(OUT_OF_SCOPE_TAG);
    const inheritedOutOfScope =
      !ownOutOfScope && (scenario.effectiveTags ?? []).includes(OUT_OF_SCOPE_TAG);
    if ((ownOutOfScope && !scenario.hasReasonComment) || inheritedOutOfScope) {
      warnings.push(
        missingReasonWarning(target.relPath, scenario, inheritedOutOfScope, target.linkId),
      );
    }
    // runner と同じく、Feature / Rule / Examples から継承したタグも見る。
    const retired = (scenario.effectiveTags ?? scenario.tags).find((tag) =>
      RETIRED_TAGS.includes(tag),
    );
    if (retired !== undefined) {
      warnings.push(retiredTagWarning(target.relPath, scenario, retired, target.linkId));
    }
  }
  return { warnings, source: { path: target.relPath, content } };
};

export interface CheckDriftOptions {
  /** Repo-relative features dir. When set, every *.feature in it is linted
   *  (draft marker, retired tags, @out-of-scope reasons, feature lint) —
   *  catching files copied in but not registered in the manifest. */
  featuresDir?: string;
  /** Glob patterns (self-implemented matcher; `*` and `**` only) identifying
   *  implementation files that should be registered in some link's impl[].
   *  When unset, unregistered-impl auditing is skipped entirely (opt-in). */
  implGlobs?: string[];
}

export const checkDrift = async (
  manifestPath: string,
  repoRoot: string,
  options: CheckDriftOptions = {},
): Promise<DriftReport> => {
  const manifest = await loadManifest(manifestPath);
  const runLimited = createTaskLimiter(MAX_CONCURRENT_FILE_READS);
  const entriesPerLink = await Promise.all(
    manifest.links.map((link) => checkLink(link, repoRoot, runLimited)),
  );
  const entries = entriesPerLink.flat();
  const driftLinkCount = new Set(entries.map((entry) => entry.linkId)).size;

  const targets = await collectFeatureTargets(manifest, repoRoot, options.featuresDir);
  const featureResults = await Promise.all(
    targets.map((target) => lintFeature(target, repoRoot, runLimited)),
  );
  const featureWarningGroups = featureResults.map((result) => result.warnings);
  // 重複と矛盾の候補はファイルをまたいで比べるので、読めた feature をまとめて渡す。
  // 同じ feature を複数の link が登録していることがある。最初の link を付ける。
  const linkIdByPath = new Map<string, string | undefined>();
  for (const target of targets) {
    if (!linkIdByPath.has(target.relPath)) linkIdByPath.set(target.relPath, target.linkId);
  }
  const contentLintWarnings: DriftWarning[] = lintFeatureSet(
    featureResults.flatMap((result) => (result.source === undefined ? [] : [result.source])),
    // 受け入れ条件から外したシナリオは、確認が無くても missing-then にしない。
    { exemptTags: [OUT_OF_SCOPE_TAG] },
  ).map((finding) => {
    const linkId = linkIdByPath.get(finding.path);
    const base = { kind: finding.kind, path: finding.path, message: finding.message };
    return linkId === undefined ? base : { linkId, ...base };
  });
  const unregisteredFeatureWarnings = targets
    .filter((target) => target.linkId === undefined)
    .map((target) => unregisteredFeatureWarning(target.relPath));

  const specHeadingWarnings = await auditSpecHeadings(manifest, repoRoot);
  const implWarnings = await auditUnregisteredImpl(manifest, repoRoot, options.implGlobs);

  const warnings = [
    ...manifest.links.filter(isEmptyLink).map(emptyLinkWarning),
    ...featureWarningGroups.flat(),
    ...contentLintWarnings,
    ...unregisteredFeatureWarnings,
    ...specHeadingWarnings,
    ...implWarnings,
  ];

  const linkIdsWithSpecChange = new Set(
    entries.filter((entry) => entry.side === "spec").map((entry) => entry.linkId),
  );
  const linkIdsWithImplChange = new Set(
    entries.filter((entry) => entry.side === "impl").map((entry) => entry.linkId),
  );
  const bothSidesChanged = [...linkIdsWithSpecChange].filter((linkId) =>
    linkIdsWithImplChange.has(linkId),
  );

  return {
    clean: entries.length === 0,
    driftCount: entries.length,
    driftLinkCount,
    entries,
    warnings,
    bothSidesChanged,
  };
};
