import { writeFileSync } from "node:fs";

import { buildSiteCss } from "../render.mjs";

writeFileSync("./site.css", buildSiteCss(), "utf8");
console.log("Built site.css from fonts, tokens, core, and enhancement layers");
