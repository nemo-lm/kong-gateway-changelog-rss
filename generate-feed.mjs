#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CHANGELOG_URL = "https://raw.githubusercontent.com/Kong/developer.konghq.com/refs/heads/main/app/_changelogs/gateway.json";
const RELEASES_URL = "https://raw.githubusercontent.com/Kong/developer.konghq.com/refs/heads/main/app/_data/products/gateway.yml";
const MAX_ITEMS = 30;
const OUT_DIR = new URL("./dist/", import.meta.url);

const TYPE_ORDER = [
  "Breaking Change",
  "deprecation",
  "feature",
  "bugfix",
  "dependency",
  "performance",
  "known-issues",
];

const TYPE_LABELS = {
  "Breaking Change": "Breaking Change",
  "deprecation": "Deprecation",
  "feature": "Feature",
  "bugfix": "Bugfix",
  "dependency": "Dependency",
  "performance": "Performance",
  "known-issues": "Known Issue",
};

const TYPE_ALIASES = {
  "breaking_change": "Breaking Change",
  "deprecated": "deprecation",
  "Feature": "feature",
};

function parseReleaseDates(yamlText) {
  const dates = {};
  const section = yamlText.split("release_dates:")[1];
  if (!section) return dates;
  for (const line of section.split("\n")) {
    const match = line.match(/^\s+'([^']+)':\s+(\S+)/);
    if (match) {
      const [, version, dateStr] = match;
      dates[version] = dateStr.replace(/\//g, "-");
    } else if (line.match(/^\S/) && line.trim() !== "") {
      break;
    }
  }
  return dates;
}

// Convert inline markdown to HTML (bold, italic, links, code)
function inlineMd(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderEntriesToHtml(gatewayEntries, managerEntries) {
  const parts = [];

  function renderGrouped(entries) {
    const byType = {};
    for (const entry of entries) {
      const type = TYPE_ALIASES[entry.type] || entry.type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(entry);
    }

    const allTypes = [
      ...TYPE_ORDER,
      ...Object.keys(byType).filter((t) => !TYPE_ORDER.includes(t)),
    ];

    for (const type of allTypes) {
      const items = byType[type];
      if (!items || items.length === 0) continue;

      parts.push(`<h3>${TYPE_LABELS[type] || type}</h3>`);

      const byScope = [];
      const scopeMap = {};
      for (const item of items) {
        const scope = item.scope || "General";
        if (!scopeMap[scope]) {
          scopeMap[scope] = [];
          byScope.push([scope, scopeMap[scope]]);
        }
        scopeMap[scope].push(item.message.trim());
      }

      for (const [scope, msgs] of byScope) {
        parts.push(`<h4>${scope}</h4>`);
        for (const msg of msgs) {
          parts.push(`<p>${inlineMd(msg)}</p>`);
        }
      }
    }
  }

  if (gatewayEntries.length > 0) {
    renderGrouped(gatewayEntries);
  }

  if (managerEntries.length > 0) {
    parts.push("<hr>");
    parts.push("<h2>Kong Manager</h2>");
    renderGrouped(managerEntries);
  }

  return parts.join("\n");
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function buildFeed() {
  const [changelogRes, releasesRes] = await Promise.all([
    fetch(CHANGELOG_URL),
    fetch(RELEASES_URL),
  ]);
  if (!changelogRes.ok || !releasesRes.ok) {
    throw new Error(`upstream fetch failed: ${changelogRes.status} ${releasesRes.status}`);
  }

  const changelog = await changelogRes.json();
  const releaseDates = parseReleaseDates(await releasesRes.text());

  const itemMap = {};

  for (const [version, products] of Object.entries(changelog)) {
    const kong = products["kong"] || [];
    const kongEe = products["kong-ee"] || [];
    const manager = products["kong-manager-ee"] || [];

    if (kong.length === 0 && kongEe.length === 0 && manager.length === 0) continue;
    if (!releaseDates[version]) continue;

    const seen = new Set();
    const gateway = [];
    for (const entry of [...kong, ...kongEe]) {
      const key = entry.message.trim();
      if (!seen.has(key)) {
        seen.add(key);
        gateway.push(entry);
      }
    }

    itemMap[version] = {
      date: releaseDates[version] || "",
      gateway,
      manager,
    };
  }

  const items = Object.entries(itemMap)
    .map(([version, data]) => ({ version, ...data }))
    .sort((a, b) =>
      b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, { numeric: true })
    )
    .slice(0, MAX_ITEMS);

  const rssItems = items.map((item) => {
    const html = renderEntriesToHtml(item.gateway, item.manager);
    const pubDate = item.date ? new Date(item.date + "T00:00:00Z").toUTCString() : "";
    const link = `https://developer.konghq.com/gateway/changelog/#${item.version.replace(/\./g, "-")}`;
    return `    <item>
      <title>${escapeXml(`Kong Gateway ${item.version}`)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(`kong-gateway-${item.version}`)}</guid>${pubDate ? `\n      <pubDate>${pubDate}</pubDate>` : ""}
      <description><![CDATA[${html}]]></description>
    </item>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Kong Gateway Changelog</title>
    <link>https://developer.konghq.com/gateway/changelog/</link>
    <description>Release notes and changelog for Kong Gateway</description>
    <language>en-us</language>
${rssItems}
  </channel>
</rss>`;
}

const INDEX_HTML = (generatedAt) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kong Gateway Changelog Feed</title>
</head>
<body>
  <h1>Kong Gateway Changelog Feed</h1>
  <p><a href="feed.xml">feed.xml</a> — regenerated daily from the upstream Kong changelog.</p>
  <p>Last generated: ${generatedAt}</p>
</body>
</html>
`;

async function main() {
  const rss = await buildFeed();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(new URL(OUT_DIR).pathname, "feed.xml"), rss);
  await writeFile(
    path.join(new URL(OUT_DIR).pathname, "index.html"),
    INDEX_HTML(new Date().toUTCString()),
  );
  console.log("wrote dist/feed.xml and dist/index.html");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
