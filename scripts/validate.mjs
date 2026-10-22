// Checks the data files before publishing: npm run validate
// Exits with an error listing every problem, so a bad daily update never goes live.
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const problems = [];
const fail = (msg) => problems.push(msg);

let D, TERMS, THREADS;
try { D = read("data/latest.json"); } catch (e) { fail("data/latest.json: " + e.message); }
try { TERMS = read("data/terms.json"); } catch (e) { fail("data/terms.json: " + e.message); }
try { THREADS = read("data/threads.json"); } catch (e) { fail("data/threads.json: " + e.message); }

if (D && TERMS && THREADS) {
  const isISO = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
  const isURL = (s) => typeof s === "string" && /^https:\/\//.test(s);
  const tzOK = (tz) => {
    if (tz === null || tz === "UTC") return true;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
  };
  const termRefs = (text, where) => {
    for (const m of String(text).matchAll(/\[\[([a-z0-9-]+)\|[^\]]+\]\]/g)) {
      if (!TERMS[m[1]]) fail(`${where}: unknown key term "${m[1]}"`);
    }
  };
  const checkSources = (list, where) => {
    if (!Array.isArray(list) || !list.length) return fail(`${where}: needs at least one source`);
    list.forEach((x, i) => {
      if (!x.outlet || !x.title) fail(`${where} source ${i + 1}: needs outlet and title`);
      if (!isURL(x.url)) fail(`${where} source ${i + 1}: url must start with https://`);
      if (!isISO(x.time)) fail(`${where} source ${i + 1}: time must be an ISO date`);
    });
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(D.date)) fail("latest.json: date must be YYYY-MM-DD");
  if (!isISO(D.snapshot)) fail("latest.json: snapshot must be an ISO date");
  if (!Array.isArray(D.stories) || D.stories.length < 5) fail("latest.json: expected at least 5 stories");

  const regions = ["Europe", "Middle East", "Africa", "Asia-Pacific", "Americas", "Global"];
  const ids = new Set();
  let main = 0;
  for (const s of D.stories || []) {
    const w = `story "${s.id}"`;
    if (!/^[a-z0-9-]+$/.test(s.id || "")) fail(`${w}: id must be lowercase letters, digits and dashes`);
    if (ids.has(s.id)) fail(`${w}: duplicate id`);
    ids.add(s.id);
    for (const k of ["topic", "city", "title", "summary"]) if (!s[k]) fail(`${w}: missing ${k}`);
    if (!regions.includes(s.region)) fail(`${w}: region must be one of ${regions.join(", ")}`);
    if (!tzOK(s.tz)) fail(`${w}: unknown time zone "${s.tz}"`);
    if ((s.lat == null) !== (s.lon == null)) fail(`${w}: give both lat and lon, or neither`);
    if (s.lat != null && (Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180)) fail(`${w}: lat/lon out of range`);
    if (s.lead === "main") main++;
    if (s.lead && !["main", "side"].includes(s.lead)) fail(`${w}: lead must be "main" or "side"`);
    if (s.thread && !THREADS[s.thread]) fail(`${w}: unknown thread "${s.thread}"`);
    termRefs(s.summary, w);
    termRefs(s.background || "", w);
    checkSources(s.sources, w);
  }
  if (main !== 1) fail(`latest.json: exactly one story needs lead "main" (found ${main})`);

  for (const s of D.lighter || []) {
    const w = `lighter "${s.id}"`;
    if (!tzOK(s.tz)) fail(`${w}: unknown time zone "${s.tz}"`);
    termRefs(s.summary, w);
    checkSources(s.sources, w);
  }
  for (const [i, x] of (D.sport || []).entries()) {
    if (!x.result || !x.note || !x.outlet || !isURL(x.url)) fail(`sport ${i + 1}: needs result, note, outlet and https url`);
  }
  for (const [id, t] of Object.entries(TERMS)) {
    if (!/^[a-z0-9-]+$/.test(id)) fail(`term "${id}": id must be lowercase letters, digits and dashes`);
    if (!t.term || !t.definition) fail(`term "${id}": needs term and definition`);
  }
  for (const [id, t] of Object.entries(THREADS)) {
    if (!t.title || !t.intro || !Array.isArray(t.events) || !t.events.length) fail(`thread "${id}": needs title, intro and events`);
    termRefs(t.intro, `thread "${id}"`);
    for (const ev of t.events || []) {
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(ev.date)) fail(`thread "${id}": event date "${ev.date}" must be YYYY-MM or YYYY-MM-DD`);
      if (!ev.text) fail(`thread "${id}": event needs text`);
      if (ev.source && !isURL(ev.source.url)) fail(`thread "${id}": event source url must start with https://`);
      termRefs(ev.text, `thread "${id}"`);
    }
    const dates = (t.events || []).map((e) => e.date);
    if (dates.join() !== [...dates].sort().join()) fail(`thread "${id}": events must be in date order`);
  }
}

if (problems.length) {
  console.error(`Found ${problems.length} problem(s):\n- ` + problems.join("\n- "));
  process.exit(1);
}
console.log(`OK: ${D.stories.length} stories, ${D.lighter.length} lighter, ${D.sport.length} sport, ${Object.keys(TERMS).length} terms, ${Object.keys(THREADS).length} timelines.`);
