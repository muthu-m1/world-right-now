// Writes today's email digest from data/latest.json: npm run digest -- https://your-site-address/
// Output: digest/subject.txt, digest/email.html and digest/email.txt (plain-text version).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const site = (process.argv[2] || "").replace(/\/?$/, "/");
const D = JSON.parse(readFileSync(new URL("../data/latest.json", import.meta.url), "utf8"));

const strip = (t) => String(t).replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, "$1");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(D.snapshot));

const top = [...D.stories.filter((s) => s.lead === "main"), ...D.stories.filter((s) => s.lead === "side"), ...D.stories.filter((s) => !s.lead)].slice(0, 8);
const light = (D.lighter || [])[0];

const subject = `World Right Now, ${day}: ${strip(top[0].title)}`;

const txt = [
  `World Right Now, ${day}`,
  "",
  ...top.flatMap((s) => [
    `${s.city.toUpperCase()}: ${strip(s.title)}`,
    strip(s.summary),
    `Source: ${s.sources[0].outlet}, ${s.sources[0].url}`,
    site !== "/" ? `Background and timeline: ${site}#s-${s.id}` : "",
    "",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "")),
  light ? `Something lighter: ${strip(light.title)} (${light.sources[0].url})` : "",
  "",
  site !== "/" ? `Read everything, with a map and key terms: ${site}` : "",
  "Summaries are written by AI from the linked reports. Check the reports before relying on them.",
].join("\n");

const item = (s) => `
  <tr><td style="padding:0 0 22px">
    <div style="font:700 13px/1.4 Segoe UI,Arial,sans-serif;color:#4B5967">${esc(s.city)}</div>
    <div style="font:700 19px/1.3 Segoe UI,Arial,sans-serif;color:#0F1A24;margin:2px 0 6px">${esc(strip(s.title))}</div>
    <div style="font:16px/1.5 Segoe UI,Arial,sans-serif;color:#0F1A24">${esc(strip(s.summary))}</div>
    <div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#4B5967;margin-top:6px">
      <a href="${esc(s.sources[0].url)}" style="color:#1F4FD1">${esc(s.sources[0].outlet)}</a>${site !== "/" ? ` · <a href="${esc(site)}#s-${esc(s.id)}" style="color:#1F4FD1">How we got here</a>` : ""}
    </div>
  </td></tr>`;

const html = `<!doctype html><html lang="en"><body style="margin:0;background:#EEF1F4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F4"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF"><tr><td style="padding:28px 28px 8px">
  <div style="font:800 28px/1.1 Segoe UI,Arial,sans-serif;color:#0F1A24;letter-spacing:-0.5px">World Right Now</div>
  <div style="font:16px/1.5 Segoe UI,Arial,sans-serif;color:#4B5967;margin:6px 0 24px">${esc(day)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${top.map(item).join("")}</table>
  ${light ? `<div style="font:16px/1.5 Segoe UI,Arial,sans-serif;color:#0F1A24;background:#D9E3FF;padding:14px 16px;margin-bottom:22px"><strong>Something lighter:</strong> <a href="${esc(light.sources[0].url)}" style="color:#0F1A24">${esc(strip(light.title))}</a></div>` : ""}
  ${site !== "/" ? `<p style="font:16px/1.5 Segoe UI,Arial,sans-serif;margin:0 0 18px"><a href="${esc(site)}" style="color:#1F4FD1;font-weight:700">Read everything, with a map and key terms</a></p>` : ""}
  <p style="font:13px/1.5 Segoe UI,Arial,sans-serif;color:#4B5967;margin:0 0 20px">Summaries are written by AI from the linked reports. Check the reports before relying on them.</p>
</td></tr></table></td></tr></table></body></html>`;

mkdirSync(new URL("../digest/", import.meta.url), { recursive: true });
writeFileSync(new URL("../digest/subject.txt", import.meta.url), subject);
writeFileSync(new URL("../digest/email.txt", import.meta.url), txt);
writeFileSync(new URL("../digest/email.html", import.meta.url), html);
console.log("digest/ written: " + subject);
