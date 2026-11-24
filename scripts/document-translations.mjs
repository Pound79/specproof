import path from "node:path";

const localeSuffix = /_(en|ja)\.md$/;
const repositoryUrl = "https://github.com/Pound79/specproof/blob/main/";

function languageLinks(file, content) {
  const header = content.split("\n").slice(0, 20).join("\n");
  return Array.from(header.matchAll(/\[(?:English|日本語)\]\(([^)]+)\)/g), ([, target]) =>
    target.startsWith(repositoryUrl)
      ? target.slice(repositoryUrl.length)
      : path.posix.join(path.posix.dirname(file), target),
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
