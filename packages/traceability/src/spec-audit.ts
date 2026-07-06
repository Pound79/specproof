import path from 'node:path';
import { listHeadings, readFileOrNull } from './hash.js';
import { resolveWithinRoot } from './resolve.js';
import type { DriftWarning } from './check.js';
import type { TraceabilityManifest } from './manifest.js';

interface FlatSpecRef {
  linkId: string;
  path: string;
  heading: string;
  level: number;
}

const flattenSpecRefs = (manifest: TraceabilityManifest): FlatSpecRef[] =>
  manifest.links.flatMap((link) =>
    link.spec.map((ref) => ({
      linkId: link.id,
      path: path.posix.normalize(ref.path),
      heading: ref.heading,
      level: ref.headingLevel ?? 2,
    }))
  );

const unregisteredHeadingWarning = (
  relPath: string,
  heading: string
): DriftWarning => ({
  kind: 'unregistered-spec-heading',
  path: relPath,
  message: `spec heading is not registered in the manifest: "${heading}" in ${relPath}`,
});

const duplicateHeadingWarning = (
  linkId: string,
  relPath: string,
  heading: string,
  count: number
): DriftWarning => ({
  linkId,
  kind: 'duplicate-heading',
  path: relPath,
  message: `heading "${heading}" appears ${count} times in ${relPath}; section hash is ambiguous`,
});

// A-2 + A-4: enumerates the ATX headings of every markdown file that already
// has at least one registered spec ref (deliberately NOT every file under
// specDir — see WAVE2-DESIGN.local.md A-2 for why that would be noisy), at
// each headingLevel the manifest actually references in that file. A heading
// with no matching registered (path, heading, level) triple is
// unregistered-spec-heading; a registered heading that occurs more than once
// is duplicate-heading (its section hash is ambiguous).
export const auditSpecHeadings = async (
  manifest: TraceabilityManifest,
  repoRoot: string
): Promise<DriftWarning[]> => {
  const refs = flattenSpecRefs(manifest);
  if (refs.length === 0) {
    return [];
  }

  const levelsByPath = new Map<string, Set<number>>();
  for (const ref of refs) {
    const levels = levelsByPath.get(ref.path) ?? new Set<number>();
    levels.add(ref.level);
    levelsByPath.set(ref.path, levels);
  }

  const warnings: DriftWarning[] = [];

  for (const [relPath, levels] of levelsByPath) {
    const content = await readFileOrNull(resolveWithinRoot(repoRoot, relPath));
    if (content === null) {
      // A missing file is already reported as spec drift on its ref(s);
      // there is nothing to enumerate headings from.
      continue;
    }

    for (const level of levels) {
      const headings = listHeadings(content, level);
      const registeredHeadings = new Set(
        refs
          .filter((ref) => ref.path === relPath && ref.level === level)
          .map((ref) => ref.heading)
      );

      for (const heading of headings) {
        if (!registeredHeadings.has(heading.text)) {
          warnings.push(unregisteredHeadingWarning(relPath, heading.text));
        }
      }

      const countByText = new Map<string, number>();
      for (const heading of headings) {
        countByText.set(heading.text, (countByText.get(heading.text) ?? 0) + 1);
      }
      for (const ref of refs) {
        if (ref.path !== relPath || ref.level !== level) {
          continue;
        }
        const count = countByText.get(ref.heading) ?? 0;
        if (count > 1) {
          warnings.push(
            duplicateHeadingWarning(ref.linkId, relPath, ref.heading, count)
          );
        }
      }
    }
  }

  return warnings;
};
