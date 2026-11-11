// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Builds THIRD_PARTY_NOTICES.md from the license files shipped inside each
// package, so the notices always match the versions actually installed.
import { emit, packageInfo, readPackageFile } from "./lib.mjs";

const bundled = [
  {
    name: "lucide-static",
    title: "Lucide icons",
    usage:
      "Icon outlines are embedded in src/render/generated/icons.ts and in every generated HTML file.",
    licenseFile: "LICENSE",
  },
  {
    name: "@fontsource/inter",
    title: "Inter typeface",
    usage:
      "Glyph metrics are embedded in src/text/generated/metrics.ts; the font itself is embedded in every generated HTML file.",
    licenseFile: "LICENSE",
  },
];

const dependencies = [
  { name: "elkjs", url: "https://github.com/kieler/elkjs" },
  { name: "zod", url: "https://github.com/colinhacks/zod" },
];

const parts = [
  "# Third-party notices",
  "",
  "trazo is licensed under the Apache License 2.0 (see LICENSE and NOTICE).",
  "It includes or depends on the following third-party material.",
  "",
  "## Bundled material",
  "",
];

for (const item of bundled) {
  const info = packageInfo(item.name);
  parts.push(
    `### ${item.title} (${item.name} ${info.version}, ${info.license})`,
    "",
    item.usage,
    "",
    "```text",
    readPackageFile(item.name, item.licenseFile).trim(),
    "```",
    "",
  );
}

parts.push(
  "## Runtime dependencies",
  "",
  "Installed by npm alongside trazo and distributed under their own licenses.",
  "",
  "| Package | Version | License | Source |",
  "|---|---|---|---|",
);
for (const dep of dependencies) {
  const info = packageInfo(dep.name);
  parts.push(`| ${dep.name} | ${info.version} | ${info.license} | ${dep.url} |`);
}
parts.push("");

emit("THIRD_PARTY_NOTICES.md", parts.join("\n"));
