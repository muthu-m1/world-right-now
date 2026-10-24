// Collects the latest headlines from every feed in data/sources.json: npm run feeds
// Writes .feeds/feeds.json (everything) and .feeds/digest.md (a compact list the daily update reads),
// grouped by region so local and rural reporting from every part of the world is in front of the editor.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MAX_AGE_H = Number(process.env.MAX_AGE_H) || 48;
const PER_FEED = Number(process.env.PER_FEED) || 14;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const { feeds } = JSON.parse(readFileSync(new URL("../data/sources.json", import.meta.url), "utf8"));
const out = new URL("../.feeds/", import.meta.url);
mkdirSync(out, { recursive: true });

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, " ") // tags that were escaped inside CDATA
    .replace(/\s+/g, " ")
    .trim();
}
function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m && decode(m[1])) return decode(m[1]);
  }
  return "";
}
function linkOf(block) {
  const atom = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  const plain = tag(block, ["link", "guid"]);
  const url = /^https?:/.test(plain) ? plain : atom ? atom[1] : "";
  return url.replace(/&amp;/g, "&");
}
function parse(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const date = tag(b, ["pubDate", "dc:date", "updated", "published"]);
    const t = Date.parse(date);
    return {
      title: tag(b, ["title"]),
      link: linkOf(b),
      time: Number.isNaN(t) ? null : new Date(t).toISOString(),
      summary: tag(b, ["description", "summary", "content:encoded", "content"]).slice(0, 220),
    };
  }).filter((i) => i.title && i.link);
}

async function get(feed) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(feed.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) return { feed, error: `HTTP ${r.status}`, items: [] };
    const items = parse(await r.text());
    const cutoff = Date.now() - MAX_AGE_H * 3600e3;
    const fresh = items.filter((i) => !i.time || Date.parse(i.time) >= cutoff)
      .sort((a, b) => (b.time || "").localeCompare(a.time || ""))
      .slice(0, PER_FEED);
    return { feed, items: fresh, total: items.length };
  } catch (e) {
    return { feed, error: e.name === "AbortError" ? "timed out" : e.message, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

// A few at a time, to be polite to the publishers.
const results = [];
for (let i = 0; i < feeds.length; i += 6) results.push(...(await Promise.all(feeds.slice(i, i + 6).map(get))));

const seen = new Set();
for (const r of results) r.items = r.items.filter((i) => (seen.has(i.link) ? false : seen.add(i.link)));

writeFileSync(new URL("feeds.json", out), JSON.stringify({ gathered: new Date().toISOString(), results }, null, 1));

const order = ["Global", "Africa", "Middle East", "Europe", "Asia-Pacific", "Americas"];
let md = `# Feed digest, gathered ${new Date().toISOString()}\n\nItems from the last ${MAX_AGE_H} hours, newest first, up to ${PER_FEED} per feed.\n`;
for (const region of order) {
  md += `\n## ${region}\n`;
  for (const r of results.filter((x) => x.feed.region === region)) {
    const where = [r.feed.city, r.feed.state, r.feed.country].filter(Boolean).join(", ");
    md += `\n### ${r.feed.name} (${r.feed.outlet}; ${r.feed.scope}${where ? "; " + where : ""})${r.error ? " — FAILED: " + r.error : ""}\n`;
    for (const i of r.items) md += `- ${i.time ? i.time.slice(0, 16).replace("T", " ") + " UTC" : "no date"} | ${i.title}\n  ${i.link}${i.summary ? "\n  " + i.summary : ""}\n`;
  }
}
writeFileSync(new URL("digest.md", out), md);

// data/wire.json: a rolling week of every headline, tagged with the feed's place, for the site's search.
// Only the headline, outlet, time and link are kept; the reporting itself stays on the publisher's site.
const WIRE_DAYS = Number(process.env.WIRE_DAYS) || 7;
const wireFile = new URL("../data/wire.json", import.meta.url);
let wire = { items: [] };
try { wire = JSON.parse(readFileSync(wireFile, "utf8")); } catch {}
const now = new Date().toISOString();
const fresh = [];
for (const r of results) {
  if (r.feed.section === "sport") continue;
  for (const i of r.items) {
    const item = { t: i.title, u: i.link, o: r.feed.outlet, at: i.time || now, r: r.feed.region };
    if (r.feed.country) item.c = r.feed.country;
    if (r.feed.state) item.s = r.feed.state;
    if (r.feed.city) item.ci = r.feed.city;
    if (r.feed.scope === "local") item.l = 1;
    fresh.push(item);
  }
}
const keep = Date.now() - WIRE_DAYS * 86400e3;
const byLink = new Map();
for (const i of [...fresh, ...(wire.items || [])]) if (!byLink.has(i.u) && Date.parse(i.at) >= keep) byLink.set(i.u, i);
const items = [...byLink.values()].sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(wireFile, JSON.stringify({ updated: now, days: WIRE_DAYS, items }) + "\n");
console.log(`data/wire.json: ${items.length} headlines from the last ${WIRE_DAYS} days`);

const failed = results.filter((r) => r.error);
const count = results.reduce((n, r) => n + r.items.length, 0);
console.log(`${count} items from ${results.length - failed.length} of ${results.length} feeds → .feeds/digest.md`);
for (const r of failed) console.log(`  failed: ${r.feed.name}: ${r.error}`);
