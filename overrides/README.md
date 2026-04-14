# Overrides

Drop a same-day editorial override file into this directory as `YYYY-MM-DD.json`.

The crawler will merge the override onto the live payload after it assembles the issue. Arrays replace the generated value. Objects merge recursively. If you include `hero`, it merges onto the generated hero after the rest of the payload override is applied.

Override files are clamped defensively: any string value longer than 2000 characters is truncated, and the file itself cannot exceed 50 KB.

To retract a generated field, set its value to `"__delete__"` and the merger will remove it from the payload before render.

Example:

```json
{
  "ticker": [
    { "text": "PHI 2-0", "highlight": true }
  ],
  "sections": {
    "preview": {
      "content": {
        "pull_quote": "Bank one clean win and make the bullpen night easy."
      }
    }
  },
  "hero": {
    "summary": "Manual same-day note from editorial."
  }
}
```
