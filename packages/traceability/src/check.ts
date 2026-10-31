import { findFeatureFiles } from "./feature-files.js";
import { uniqueFeatureTargets } from "./feature-identity.js";
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
import {
  type GherkinFlavor,
  type ParseOptions,
  parseFeatureScenarios,
  type ScannedScenario,
} from "./feature-scan.js";
import { loadManifest, type TraceabilityLink, type TraceabilityManifest } from "./manifest.js";
import { resolveWithinRoot } from "./resolve.js";
import { OUT_OF_SCOPE_TAG, DISALLOWED_TAGS } from "./config.js";
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
    | "disallowed-tag"
    | "unregistered-feature"
    | "unregistered-spec-heading"
    | "unregistered-impl"
    | "duplicate-heading"
    | "features-dir-unset"
    | "features-dir-missing"
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

// runner が実行を止める・失敗を想定扱いにするタグ。付いていると条件が確かめられないまま残る。
const disallowedTagWarning = (
  featurePath: string,
  scenario: ScannedScenario,
  tag: string,
  linkId?: string,
): DriftWarning =>
  withLink(
    {
      kind: "disallowed-tag",
      path: featurePath,
      message: `scenario "${scenario.name}" (${featurePath}:${scenario.line}) carries ${tag}, which makes the runner skip or mute it — switching a scenario off is not allowed; remove it and use @red-contract (not implemented yet), @human (checked by a person) or ${OUT_OF_SCOPE_TAG} (excluded, with a reason comment)`,
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

// 設定ファイルがあるのに featuresDir が無いと、登録していない feature の
// ドラフトマーカー・止めるタグ・lint を検査しない（登録済みの feature だけを見る）。
// 設定の文書では必須なので、黙って検査を外さず知らせる。設定ファイルを置かない engine
// 単体の利用は従来どおり既定値で動かし、警告しない。
const featuresDirUnsetWarning = (configFile: string): DriftWarning => ({
  kind: "features-dir-unset",
  path: configFile,
  message: `${configFile} has no layout.featuresDir, so .feature files that no link registers are not checked for draft markers, disallowed tags or lint. Set layout.featuresDir to the directory holding the .feature files.`,
});

// featuresDir を書いていても、指す先が無い・ディレクトリでないと同じく検査が外れる。
// 設定を別名に書き換えるだけでゲートを素通りさせないよう、こちらも知らせる。
const featuresDirMissingWarning = (featuresDir: string): DriftWarning => ({
  kind: "features-dir-missing",
  path: featuresDir,
  message: `featuresDir ${JSON.stringify(featuresDir)} is not an existing directory, so .feature files that no link registers are not checked for draft markers, disallowed tags or lint.`,
});

// A feature file to lint, with its manifest link id when it is registered.
interface FeatureTarget {
  relPath: string;
  linkId?: string;
}

interface FeatureTargets {
  targets: FeatureTarget[];
  /** featuresDir を指定したのに、存在しない・ディレクトリでないため走査できなかった。 */
  featuresDirMissing: boolean;
}

// 登録済み feature と featuresDir 配下の未登録 feature を lint する。
// 実体パスで重複を除き、最初の登録済みパスと linkId を報告に使う。
const collectFeatureTargets = async (
  manifest: TraceabilityManifest,
  repoRoot: string,
  featuresDir: string | undefined,
): Promise<FeatureTargets> => {
  const registered = uniqueFeatureTargets(
    repoRoot,
    manifest.links.flatMap((link) =>
      link.features.map((ref) => ({
        relPath: path.posix.normalize(ref.path),
        linkId: link.id,
      })),
    ),
    (target) => target.relPath,
  );

  if (featuresDir === undefined) {
    return { targets: registered, featuresDirMissing: false };
  }
  let entries: string[];
  try {
    entries = await findFeatureFiles(repoRoot, featuresDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { targets: registered, featuresDirMissing: true };
    }
    throw error;
  }
  // 登録と探索を同じ規則で照合する。登録順を先に置き、別名だけの登録でも
  // linkId を保持する。ENOENT / ENOTDIR 以外の実体解決エラーは握り潰さない。
  const targets = uniqueFeatureTargets<FeatureTarget>(
    repoRoot,
    [...registered, ...entries.map((relPath) => ({ relPath }))],
    (target) => target.relPath,
  );
  return { targets, featuresDirMissing: false };
};

// Reads a feature file once and runs the per-file lints on it (draft marker +
// skip/fixme reason comments). Returns the content too, so the cross-file
// feature lint can compare scenarios. Missing files are left to drift detection.
const lintFeature = async (
  target: FeatureTarget,
  repoRoot: string,
  runLimited: RunTaskLimited,
  parse: ParseOptions,
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
  for (const scenario of parseFeatureScenarios(target.relPath, content, parse)) {
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
    const disallowed = (scenario.effectiveTags ?? scenario.tags).find((tag) =>
      DISALLOWED_TAGS.includes(tag),
    );
    if (disallowed !== undefined) {
      warnings.push(disallowedTagWarning(target.relPath, scenario, disallowed, target.linkId));
    }
  }
  return { warnings, source: { path: target.relPath, content } };
};

export interface CheckDriftOptions {
  /** Repo-relative features dir. When set, every *.feature in it is linted
   *  (draft marker, disallowed tags, @out-of-scope reasons, feature lint) —
   *  catching files copied in but not registered in the manifest. */
  featuresDir?: string;
  /** Glob patterns (self-implemented matcher; `*` and `**` only) identifying
   *  implementation files that should be registered in some link's impl[].
   *  When unset, unregistered-impl auditing is skipped entirely (opt-in). */
  implGlobs?: string[];
  /** feature を読む規則。adapter: flutter なら dart（既定は js）。 */
  gherkin?: GherkinFlavor;
  /** runner の既定の Gherkin 言語。dart の規則で、宣言の無い feature に使う。 */
  language?: string;
  /** 読んだ設定ファイルの名前。設定ファイルがあるのに featuresDir が無ければ
   *  features-dir-unset を警告する。 */
  configFile?: string;
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

  const parse: ParseOptions = { gherkin: options.gherkin ?? "js", language: options.language };
  const { targets, featuresDirMissing } = await collectFeatureTargets(
    manifest,
    repoRoot,
    options.featuresDir,
  );
  const featureResults = await Promise.all(
    targets.map((target) => lintFeature(target, repoRoot, runLimited, parse)),
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
    { exemptTags: [OUT_OF_SCOPE_TAG], ...parse },
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
    ...(options.configFile !== undefined && options.featuresDir === undefined
      ? [featuresDirUnsetWarning(options.configFile)]
      : []),
    ...(featuresDirMissing && options.featuresDir !== undefined
      ? [featuresDirMissingWarning(options.featuresDir)]
      : []),
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
