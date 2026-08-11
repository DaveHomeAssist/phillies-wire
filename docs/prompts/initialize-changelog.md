# Prompt: Initialize the Phillies Wire changelog

Use this prompt in a fresh repository task when Phillies Wire is ready to adopt a project changelog.

```text
Create a concise, evidence-based `CHANGELOG.md` for Phillies Wire.

Read first:
1. `CLAUDE.md` and `README.md`.
2. `package.json`, the publishing workflow, and the current test harness.
3. `git log --date=short --pretty=format:'%h %ad %s'` and the relevant diffs.

Rules:
- Use dated sections, newest first. Do not invent version numbers when no matching release tag exists.
- Separate product and platform changes from automated issue-publication commits.
- Summarize routine `Update published issue` commits by date or operational outcome; do not create one changelog bullet per generated issue.
- Begin with a `2026-08-10` section covering delivery hardening, Nodemailer 9.0.5, disabled file/URL message access, corrected away-game venue schema, CSP and external-link hardening, responsive navigation, reduced-motion and contrast improvements, and the successful 21-file test gate.
- Preserve the distinction between generated editorial content, live MLB-derived data, and application code.
- Record only behavior present on `origin/main` and verified by tests, a deployment, or direct inspection.
- Do not describe scheduled data refreshes as product releases unless they changed behavior or corrected material content.

Verification:
- Run `npm test` and `npm audit --omit=dev`.
- Run `git diff --check`.
- Confirm all referenced change commits are ancestors of `origin/main`.
- Note any generated history that cannot be summarized without editorial judgment.
```
