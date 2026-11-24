# Contributing to specproof

English | [日本語](CONTRIBUTING_ja.md)

## Set up and verify

Use Node.js 24 or later. From the repository root, run the following checks in order. Some tests launch the built CLI.

```sh
npm ci
npm run typecheck
npm run build
npm run lint
npm run format:check
npm test
npm run test:coverage
```

Use `npm run format` to format the sources. See the [quality gates](docs/quality-gates_en.md) for coverage and CI settings.

## Submit a change

1. Fork the repository and create a focused branch such as `fix/...`, `feat/...` or `docs/...`.
2. For behavior changes, observe a failing test first. Run the checks above before submitting.
3. Use Conventional Commits, e.g. `fix: …`. Describe the change in Japanese. Keep every line within 72 characters. CLI diagnostics are in English.
4. Link the issue in your pull request and explain the change and how you verified it. For behavior and architecture decisions, reference or add an ADR under `docs/adr/`.
5. Update both languages of user and contributor guides in the same PR. Keep the existing canonical filename; add `_ja.md` for a Japanese counterpart or `_en.md` for an English counterpart. Link both ways. Keep runnable skill instructions and shared code examples in one place.

The npm workspaces are `packages/traceability/` (drift detection) and `cli/` (scaffolding). Agent skills live in `plugins/specproof/`, adapters in `templates/`, and methodology, schema and design decisions in `docs/`. See the [glossary](CONTEXT_en.md), [release procedure](RELEASING.md) and [code of conduct](CODE_OF_CONDUCT.md).

## Check what you publish

CI checks tracked paths and contents for machine-specific paths, unexpected email addresses, local notes, `docs/evidence/`, and dotenv files other than examples. Configure the hooks in each clone to check private names against a list kept outside the repository.

```sh
git config core.hooksPath scripts/githooks
mkdir -p ~/.config/git
$EDITOR ~/.config/git/private-terms.txt
```

Use one term per line. Blank lines and lines beginning with `#` are ignored. Set `SPECPROOF_PRIVATE_TERMS` for a different path. With no list, the hooks report that they skipped this check.

Pre-commit checks staged paths, contents and identity. Commit-msg checks the entire message, including comments and text below scissors. If a comment or verbose diff triggers it, use a clean message file with `git commit -F <file>`. Pre-push checks destination ref names, outgoing commits, annotated tag chains and targets including trees and blobs. Ref deletions are allowed.

Matching ignores case and uses NFC normalization. CI and hooks read UTF-8 and BOM-marked UTF-16, including content containing NUL. Terms in BOM-less UTF-16 or Shift_JIS may go undetected. Review hooks on unfamiliar branches before committing or pushing because the checkout supplies the code they execute.
