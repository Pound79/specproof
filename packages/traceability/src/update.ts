import {
  computeFileHash,
  computeHeadingSectionHash,
  FILE_MISSING,
  isClean,
  isSentinel,
  PENDING_HASH,
  SECTION_MISSING,
  withSectionScanCache,
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
import {
  headingLevelOf,
  matchesSelector,
  parseSpecRefSelector,
  type SpecRefSelector,
} from "./spec-ref-selector.js";

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
    computeHeadingSectionHash(
      resolveWithinRoot(repoRoot, ref.path),
      ref.heading,
      ref.headingLevel,
      linkId,
    ),
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

interface LinkResult {
  link: TraceabilityLink;
  changes: UpdateChange[];
  skipped?: UpdateSkip;
}

const unchanged = (link: TraceabilityLink): LinkResult => ({ link, changes: [] });

// impl の参照のどれかが drift しているか。check の bothSidesChanged と同じ判定（無くなったもの・保存値が
// 番兵値のものも drift と数える）にする。食い違うと、check では両側の変更なのに spec 側だけを bless してしまう。
const implDrifted = async (
  link: TraceabilityLink,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<boolean> => {
  const hashes = await Promise.all(
    link.impl.map((ref) =>
      runLimited(() => computeFileHash(resolveWithinRoot(repoRoot, ref.path))),
    ),
  );
  return hashes.some((hash, index) => !isClean(link.impl[index].hash, hash));
};

/** --spec-ref の計画: リンクの id ごとに、取り直す spec の参照の位置と新しい hash。 */
type SpecRefPlan = ReadonlyMap<string, ReadonlyMap<number, string>>;

interface SelectedRef {
  link: TraceabilityLink;
  index: number;
  ref: SpecRef;
}

const describeSelector = (selector: SpecRefSelector): string => JSON.stringify(selector.raw);

// 1 つの指定について、書く前に曖昧さを除く。深さの違う同名の節が混ざる、bless した版がリンクごとに違う、
// 一度も bless していない（PENDING）、のどれかなら、人が確かめた 1 つの変更として扱えないので止める。
const planSelector = async (
  selector: SpecRefSelector,
  matches: SelectedRef[],
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<{ match: SelectedRef; hash: string }[]> => {
  if (new Set(matches.map((match) => headingLevelOf(match.ref))).size > 1) {
    throw new Error(
      `Cannot update: --spec-ref ${describeSelector(selector)} matches sections of different heading levels; bless those links with --link-id instead.`,
    );
  }
  const refreshed = await Promise.all(
    matches.map(async (match) => ({
      match,
      hash: (await refreshSpecRef(match.ref, match.link.id, repoRoot, runLimited)).ref.hash,
    })),
  );
  const stale = refreshed.filter(({ match, hash }) => match.ref.hash !== hash);
  const baselines = new Set(stale.map(({ match }) => match.ref.hash));
  if (
    baselines.size > 1 ||
    [...baselines].some((hash) => hash === PENDING_HASH || isSentinel(hash))
  ) {
    throw new Error(
      `Cannot update: --spec-ref ${describeSelector(selector)} was blessed at different versions (or never) in the selected links; review and bless those links with --link-id instead.`,
    );
  }
  return stale;
};

// 指定した節を、対象のリンクで探して計画にする。どれかの指定が対象のリンクに無ければ、何も書かずに止める。
const planSpecRefRefresh = async (
  links: readonly TraceabilityLink[],
  specRefs: readonly string[] | undefined,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<SpecRefPlan | undefined> => {
  if (specRefs === undefined) return undefined;
  if (specRefs.length === 0) {
    throw new Error("Cannot update: specRefs is empty; omit it to update every reference.");
  }
  const selectors = specRefs.map(parseSpecRefSelector);
  const matchesOf = (selector: SpecRefSelector): SelectedRef[] =>
    links.flatMap((link) =>
      link.spec.flatMap((ref, index) =>
        matchesSelector(ref, selector) ? [{ link, index, ref }] : [],
      ),
    );
  const missing = selectors.filter((selector) => matchesOf(selector).length === 0);
  if (missing.length > 0) {
    const refs = missing.map(describeSelector).join(", ");
    throw new Error(`Cannot update: no spec reference ${refs} in the selected link(s).`);
  }
  const planned = (
    await Promise.all(
      selectors.map((selector) =>
        planSelector(selector, matchesOf(selector), repoRoot, runLimited),
      ),
    )
  ).flat();
  const plan = new Map<string, Map<number, string>>();
  for (const { match, hash } of planned) {
    plan.set(match.link.id, new Map([...(plan.get(match.link.id) ?? []), [match.index, hash]]));
  }
  return plan;
};

// --spec-ref: 計画した spec の参照の hash だけを書き換える。impl も drift したリンクは、spec 側だけを bless すると
// 「spec と impl の両方が変わった」の信号が消えるので、書き換えずに飛ばす（人が sync で決めてから --link-id で bless する）。
const applySpecRefPlan = async (
  link: TraceabilityLink,
  plan: SpecRefPlan,
  repoRoot: string,
  runLimited: RunTaskLimited,
): Promise<LinkResult> => {
  const hashes = plan.get(link.id);
  if (hashes === undefined || hashes.size === 0) return unchanged(link);
  if (await implDrifted(link, repoRoot, runLimited)) {
    return { link, changes: [], skipped: { linkId: link.id, reason: "impl-drift" } };
  }
  const changes: UpdateChange[] = [...hashes].map(([index, newHash]) => ({
    linkId: link.id,
    side: "spec",
    path: link.spec[index].path,
    heading: link.spec[index].heading,
    oldHash: link.spec[index].hash,
    newHash,
  }));
  const spec = link.spec.map((ref, index) => {
    const newHash = hashes.get(index);
    return newHash === undefined ? ref : { ...ref, hash: newHash };
  });
  return { link: { ...link, spec }, changes };
};

const selectedLinkIds = (
  manifest: TraceabilityManifest,
  options: UpdateOptions,
): ReadonlySet<string> | undefined => {
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
  return requested.length === 0 ? undefined : new Set(requested);
};

export interface UpdateSkip {
  linkId: string;
  /** impl-drift: the link's impl also drifted (including a missing file), so
   *  only blessing its spec side would hide "both spec and impl changed".
   *  Decide with specproof-sync first. */
  reason: "impl-drift";
}

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
  /** `<path>#<heading>` of spec sections. When set, only the spec-side hash of
   *  these sections is re-hashed, in every link that references them (narrowed
   *  by `linkId` / `linkIds` when given); impl and feature hashes and other spec
   *  sections are left untouched. A link whose impl also drifted is skipped
   *  (see `UpdateResult.skipped`). A section no selected link references is an
   *  error, and nothing is written. */
  specRefs?: readonly string[];
}

export interface UpdateResult extends TraceabilityManifest {
  /** Every ref whose hash actually changed in this run, in manifest order.
   *  Empty when nothing changed (including a dry run that found no drift). */
  changes: UpdateChange[];
  /** Links left untouched by `specRefs` because their impl also drifted.
   *  Present only when `specRefs` is set, so a caller that treats the result
   *  minus `changes` as the manifest keeps working. */
  skipped?: UpdateSkip[];
}

// 同じ spec を参照するリンクが多くても、中身ごとの走査は実行の間だけ使い回す。
export const updateManifestHashes = (
  requestedManifestPath: string,
  repoRoot: string,
  options: UpdateOptions = {},
): Promise<UpdateResult> =>
  withSectionScanCache(() =>
    updateManifestHashesUncached(requestedManifestPath, repoRoot, options),
  );

const updateManifestHashesUncached = async (
  requestedManifestPath: string,
  repoRoot: string,
  options: UpdateOptions,
): Promise<UpdateResult> => {
  // saveManifest は最終要素のリンクを辿って書くため、公開 API の入口でも
  // manifest とそのリンク先が repo 内にあることを確かめる（相対パスは従来どおり cwd 基準）。
  const manifestPath = resolveWithinRoot(repoRoot, path.resolve(requestedManifestPath));
  const manifest = await loadManifest(manifestPath);
  const runLimited = createTaskLimiter(MAX_CONCURRENT_FILE_READS);
  const { dryRun = false } = options;
  const selected = selectedLinkIds(manifest, options);
  const inScope = (link: TraceabilityLink): boolean =>
    selected === undefined || selected.has(link.id);
  const plan = await planSpecRefRefresh(
    manifest.links.filter(inScope),
    options.specRefs,
    repoRoot,
    runLimited,
  );
  const results: LinkResult[] = await Promise.all(
    manifest.links.map((link) => {
      if (!inScope(link)) return Promise.resolve(unchanged(link));
      return plan === undefined
        ? refreshLink(link, repoRoot, runLimited)
        : applySpecRefPlan(link, plan, repoRoot, runLimited);
    }),
  );
  const updated: TraceabilityManifest = {
    ...manifest,
    links: results.map((result) => result.link),
  };
  const changes = results.flatMap((result) => result.changes);
  if (!dryRun && changes.length > 0) {
    await saveManifest(manifestPath, updated, manifest, repoRoot);
  }
  if (plan === undefined) return { ...updated, changes };
  const skipped = results.flatMap((result) => (result.skipped ? [result.skipped] : []));
  return { ...updated, changes, skipped };
};
