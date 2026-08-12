# Phillies Wire ships a faster, layout-stable briefing foundation

Phillies Wire has completed its Now-phase web performance package, focused on the briefing defect readers feel most: content moving while the page loads.

The publication now serves one compiled stylesheet instead of four blocking style requests. The existing font, token, core, and Liberty Bell enhancement files remain independently maintained, while the renderer deterministically compiles them for delivery on the latest issue, dated issues, archive, and deployment artifact.

Self-hosted display and body fonts are preloaded and use an optional loading strategy with stronger fallback stacks. This prevents a late font swap from reflowing the masthead and game briefing, directly targeting the 0.271 mobile CLS measured in the portfolio audit.

The change is generator-backed and regression-tested, so the daily publishing bot cannot silently return the site to the slower path. The release also adds repository-wide vulnerability, secret, and configuration scanning; weekly dependency updates; a changelog; and a proof-oriented release checklist.

The editorial identity is unchanged: Phillies Wire retains its Liberty Bell, pinstripe, and broadsheet system while becoming calmer and faster to read.
