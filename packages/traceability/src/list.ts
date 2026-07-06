import path from "node:path";
import type { TraceabilityManifest } from "./manifest.js";

export interface RegisteredDomain {
  id: string;
  label: string;
  featureCount: number;
}

export interface DomainCandidate {
  /** Suggested kebab-case `<domain>` argument for the specproof-bootstrap
   *  skill. */
  suggestedDomain: string;
  /** Repo-relative path of the page that has no traceability link yet. */
  page: string;
}

export interface DomainList {
  registered: RegisteredDomain[];
  candidates: DomainCandidate[];
}

export interface BuildDomainListOptions {
  /**
   * Repo-relative directory the page file names live under. When set, each
   * candidate path is rendered as `${pagesDir}/${name}`; when empty the bare
   * file name is used. The CLI supplies this from specproof.config.yaml
   * (`layout.pagesDir`).
   */
  pagesDir?: string;
  /**
   * File-name suffix marking a file as a domain page. Defaults to `Page.tsx`
   * (the playwright/React convention); a Flutter adapter would pass e.g.
   * `_page.dart`.
   */
  candidateSuffix?: string;
}

/**
 * CamelCase page base name (without extension) to a kebab-case domain id.
 * e.g. "CompanyDataPage" -> "company-data", "SfMatchingDebugPage" ->
 * "sf-matching-debug". The acronym pass runs before the lower-upper pass so
 * runs like "APACModel" split as "apac-model", not "a-p-a-c-model".
 */
export const toDomainName = (pageBaseName: string): string =>
  pageBaseName
    .replace(/Page$/, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

/**
 * Registered domains (from the manifest) plus untracked page candidates: files
 * matching `candidateSuffix` that are not referenced by any link's `impl`
 * entry. Pure (no filesystem access) so it is unit-testable; the CLI supplies
 * the page file names via readdir and the directory/suffix via config.
 */
export const buildDomainList = (
  manifest: TraceabilityManifest,
  pageFileNames: string[],
  options: BuildDomainListOptions = {},
): DomainList => {
  const pagesDir = (options.pagesDir ?? "").replaceAll("\\", "/");
  const candidateSuffix = options.candidateSuffix ?? "Page.tsx";

  const registered: RegisteredDomain[] = manifest.links.map((link) => ({
    id: link.id,
    label: link.label,
    featureCount: link.features.length,
  }));

  const referencedImpl = new Set(
    manifest.links.flatMap((link) => link.impl.map((ref) => ref.path)),
  );

  const candidates: DomainCandidate[] = pageFileNames
    .filter((name) => name.endsWith(candidateSuffix))
    .map((name) => (pagesDir ? path.posix.join(pagesDir, name) : name))
    .filter((page) => !referencedImpl.has(page))
    .map((page) => {
      const base = path.posix
        .basename(page)
        .replace(/\.[^./]+$/, "");
      return { suggestedDomain: toDomainName(base), page };
    })
    .sort((a, b) => a.suggestedDomain.localeCompare(b.suggestedDomain));

  return { registered, candidates };
};

/**
 * Renders a DomainList as the plain-text report printed by the list CLI (the
 * `--json` branch is handled separately in the CLI). Pure so the column
 * padding, the empty-candidates `(none)` line and the bootstrap hint can be
 * unit-tested without spawning the CLI or touching the filesystem.
 */
export const formatDomainList = ({
  registered,
  candidates,
}: DomainList): string => {
  const idWidth = Math.max(0, ...registered.map((domain) => domain.id.length));
  const lines = [
    `Registered domains (${registered.length}) — targets for specproof-sync and specproof-bootstrap:`,
    ...registered.map(
      (domain) =>
        `  ${domain.id.padEnd(idWidth)}  ${domain.label}  (features: ${domain.featureCount})`,
    ),
    "",
    `Untracked bootstrap candidates (${candidates.length}) — pages with no traceability link:`,
  ];

  if (candidates.length === 0) {
    lines.push("  (none)");
    return lines.join("\n");
  }

  const domainWidth = Math.max(
    0,
    ...candidates.map((candidate) => candidate.suggestedDomain.length),
  );
  for (const candidate of candidates) {
    lines.push(
      `  ${candidate.suggestedDomain.padEnd(domainWidth)}  ${candidate.page}`,
    );
  }
  lines.push(
    "",
    "Bootstrap one with: specproof-bootstrap <domain> " +
      "(suggested-domain shown above; rename if a cleaner id fits).",
  );
  return lines.join("\n");
};
