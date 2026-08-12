# Changelog

All material Phillies Wire changes are recorded here, newest first.

## 2026-08-12

### Performance and stability

- Consolidated the four render-blocking style layers into one generated site.css while retaining the layered source files as the editing contract.
- Preloaded the primary display and body fonts, switched self-hosted fonts to font-display: optional, and added metric-compatible fallback stacks to prevent late font swaps from shifting the game briefing.
- Updated the renderer, archive, current issue, site-artifact builder, verification gate, and pipeline smoke test so daily publication preserves the optimized delivery path.

### Security and operations

- Added pinned repository scanning for dependency vulnerabilities, exposed secrets, and configuration mistakes.
- Enabled Dependabot vulnerability alerts, automated security fixes, and weekly dependency updates.
