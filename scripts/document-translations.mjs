import path from "node:path";
import { marked } from "marked";

const localeSuffix = /_(en|ja)\.md$/;
const repositoryUrl = "https://github.com/Pound79/specproof/blob/main/";

function linkedPath(file, target) {
  if (target.startsWith(repositoryUrl)) return target.slice(repositoryUrl.length);
  return path.posix.join(path.posix.dirname(file), target);
}

function languageLinks(file, content) {
  const header = content.split("\n").slice(0, 20).join("\n");
  return Array.from(header.matchAll(/\[(?:English|日本語)\]\(([^)]+)\)/g), ([, target]) =>
    linkedPath(file, target),
  );
}

export function translationIssues(documents) {
  const issues = [];
  for (const [file, content] of documents) {
    // GitHub の issue テンプレートは言語別のフォームを選択画面から開く。
    if (file.startsWith(".github/ISSUE_TEMPLATE/")) continue;
    const links = languageLinks(file, content);
    for (const target of links) {
      if (!documents.has(target)) issues.push(`${file}: missing translation ${target}`);
    }
    if (!localeSuffix.test(file)) continue;
    const canonical = file.replace(localeSuffix, ".md");
    if (!links.includes(canonical)) issues.push(`${file}: link to ${canonical}`);
    const original = documents.get(canonical);
    if (original === undefined || !languageLinks(canonical, original).includes(file)) {
      issues.push(`${canonical}: link to ${file}`);
    }
  }
  return issues;
}

export function indexIssues(documents) {
  const issues = [];
  for (const file of ["docs/README.md", "docs/README_ja.md"]) {
    const index = documents.get(file);
    if (index === undefined) {
      issues.push(`${file}: missing index`);
      continue;
    }

    marked.walkTokens(marked.lexer(index), (token) => {
      if (token.type !== "link") return;
      const [target] = token.href.split(/[?#]/, 1);
      if (!target) return;
      const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) && !target.startsWith(repositoryUrl);
      if (external) return;
      const guide = linkedPath(file, decodeURIComponent(target));
      if (!documents.has(guide)) issues.push(`${file}: missing guide ${guide}`);
    });
  }
  return issues;
}
