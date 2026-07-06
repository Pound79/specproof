import { describe, expect, it } from "vitest";
import { buildDomainList, formatDomainList, toDomainName } from "../list.js";
import type { DomainList } from "../list.js";
import type { TraceabilityManifest } from "../manifest.js";

const PAGES_DIR = "packages/web/src/pages/exampleApp";

describe("toDomainName", () => {
  it("strips the Page suffix and kebab-cases the rest", () => {
    expect(toDomainName("CompanyDataPage")).toBe("company-data");
    expect(toDomainName("CompareDebugPage")).toBe("compare-debug");
  });

  it("splits acronym runs before the lower-upper boundary", () => {
    expect(toDomainName("SfMatchingDebugPage")).toBe("sf-matching-debug");
    expect(toDomainName("APACModelPage")).toBe("apac-model");
  });
});

describe("buildDomainList", () => {
  const manifest: TraceabilityManifest = {
    version: 1,
    links: [
      {
        id: "history",
        label: "生成履歴の閲覧",
        spec: [],
        impl: [
          {
            path: "packages/web/src/pages/exampleApp/HistoryListPage.tsx",
            hash: "h1",
          },
        ],
        features: [
          { path: "packages/e2e/features/history.feature", hash: "h2" },
        ],
      },
    ],
  };

  it("lists registered domains with feature counts", () => {
    const { registered } = buildDomainList(manifest, []);
    expect(registered).toEqual([
      { id: "history", label: "生成履歴の閲覧", featureCount: 1 },
    ]);
  });

  it("flags suffix-matching files not referenced by any impl as candidates, sorted (with pagesDir)", () => {
    const { candidates } = buildDomainList(
      manifest,
      [
        "HistoryListPage.tsx", // referenced by impl -> excluded
        "CompareDebugPage.tsx", // candidate
        "companyDataUtils.ts", // not a *Page.tsx -> excluded
        "CompanyDataPage.tsx", // candidate
      ],
      { pagesDir: PAGES_DIR },
    );
    expect(candidates).toEqual([
      {
        suggestedDomain: "company-data",
        page: `${PAGES_DIR}/CompanyDataPage.tsx`,
      },
      {
        suggestedDomain: "compare-debug",
        page: `${PAGES_DIR}/CompareDebugPage.tsx`,
      },
    ]);
  });

  it("uses bare file names as candidate paths when no pagesDir is given", () => {
    const { candidates } = buildDomainList(manifest, ["CompareDebugPage.tsx"]);
    expect(candidates).toEqual([
      { suggestedDomain: "compare-debug", page: "CompareDebugPage.tsx" },
    ]);
  });

  it("normalises backslash pagesDir to forward slashes for manifest matching", () => {
    const { candidates } = buildDomainList(
      manifest,
      ["CompareDebugPage.tsx"],
      { pagesDir: "src\\pages" },
    );
    expect(candidates).toEqual([
      {
        suggestedDomain: "compare-debug",
        page: "src/pages/CompareDebugPage.tsx",
      },
    ]);
  });

  it("honours a non-default candidateSuffix", () => {
    const { candidates } = buildDomainList(
      manifest,
      ["home_page.dart", "helpers.dart"],
      { candidateSuffix: "_page.dart" },
    );
    expect(candidates).toEqual([
      { suggestedDomain: "home_page", page: "home_page.dart" },
    ]);
  });
});

describe("formatDomainList", () => {
  const registered = [
    { id: "history", label: "生成履歴の閲覧", featureCount: 1 },
  ];

  it("shows the (none) line and no bootstrap hint when there are no candidates", () => {
    const out = formatDomainList({ registered, candidates: [] });
    expect(out).toContain(
      "Registered domains (1) — targets for specproof-sync and specproof-bootstrap:",
    );
    expect(out).toContain("  history  生成履歴の閲覧  (features: 1)");
    expect(out).toContain(
      "Untracked bootstrap candidates (0) — pages with no traceability link:",
    );
    expect(out).toContain("  (none)");
    expect(out).not.toContain("Bootstrap one with:");
  });

  it("pads suggested-domain to the widest entry and appends the bootstrap hint", () => {
    const out = formatDomainList({
      registered,
      candidates: [
        {
          suggestedDomain: "company-data",
          page: `${PAGES_DIR}/CompanyDataPage.tsx`,
        },
        {
          suggestedDomain: "compare-debug",
          page: `${PAGES_DIR}/CompareDebugPage.tsx`,
        },
      ],
    });
    // 'company-data' (12) padded to the width of 'compare-debug' (13) -> one
    // extra space before the two-space column separator.
    expect(out).toContain(`  company-data   ${PAGES_DIR}/CompanyDataPage.tsx`);
    expect(out).toContain(`  compare-debug  ${PAGES_DIR}/CompareDebugPage.tsx`);
    expect(out).toContain(
      "Bootstrap one with: specproof-bootstrap <domain> (suggested-domain shown above; rename if a cleaner id fits).",
    );
  });

  it("renders the zero-domain header when the manifest is empty", () => {
    const empty: DomainList = { registered: [], candidates: [] };
    const out = formatDomainList(empty);
    expect(out).toContain(
      "Registered domains (0) — targets for specproof-sync and specproof-bootstrap:",
    );
    expect(out).toContain("  (none)");
  });
});
