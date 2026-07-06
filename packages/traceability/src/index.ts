// Public library surface for @pound79/specproof-traceability.
// CLI entrypoints (cli-check / cli-update / cli-list) are exposed via package
// `bin`, not re-exported here.

export {
  loadManifest,
  saveManifest,
  type SpecRef,
  type FileRef,
  type TraceabilityLink,
  type TraceabilityManifest,
} from "./manifest.js";

export {
  computeFileHash,
  computeHeadingSectionHash,
  containsDraftMarker,
  DRAFT_MARKER,
  FILE_MISSING,
  hasDraftMarker,
  SECTION_MISSING,
} from "./hash.js";

export { parseScenarios, type ScannedScenario } from "./feature-scan.js";

export {
  buildStats,
  formatStats,
  type DomainStats,
  type StatsReport,
  type StatsTags,
  type FeatureScenarios,
} from "./stats.js";

export { resolveWithinRoot } from "./resolve.js";

export { resolveRepoRoot, resolveDefaultManifestPath } from "./paths.js";

export {
  discoverConfig,
  DEFAULT_FIXME_TAG,
  DEFAULT_SKIP_TAG,
  type TraceabilityConfig,
  type DiscoverConfigOverrides,
} from "./config.js";

export {
  checkDrift,
  type CheckDriftOptions,
  type DriftSide,
  type DriftEntry,
  type DriftReport,
  type DriftWarning,
} from "./check.js";

export {
  updateManifestHashes,
  type UpdateChange,
  type UpdateOptions,
  type UpdateResult,
} from "./update.js";

export {
  buildDomainList,
  formatDomainList,
  toDomainName,
  type DomainList,
  type RegisteredDomain,
  type DomainCandidate,
  type BuildDomainListOptions,
} from "./list.js";
