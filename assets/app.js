// World Right Now: renders today's stories, the map, ongoing stories and key terms
// from the JSON files in data/. No libraries and no outside requests.
(function () {
  "use strict";

  var state = { region: "All", topic: "All" };
  try {
    var saved = JSON.parse(localStorage.getItem("wrn-filters") || "null");
    if (saved && saved.region && saved.topic) state = saved;
  } catch (e) {}

  var D, TERMS, THREADS;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(text, href, cls) {
    var a = el("a", cls, text);
    a.href = href;
    if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  // ---- Time ---------------------------------------------------------------
  function partOfDay(h) {
    if (h < 5) return "night";
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    if (h < 21) return "evening";
    return "night";
  }
  function localTime(tz) {
    if (tz === null) return "No official time zone yet";
    var now = new Date();
    if (tz === "UTC") {
      return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(now) + " UTC";
    }
    try {
      var t = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(now).toLowerCase();
      var h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
      return t + " there, " + partOfDay(h);
    } catch (e) { return ""; }
  }
  function shortTime(tz) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date()).toLowerCase();
  }
  function ago(iso) {
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return Math.max(mins, 1) + " min ago";
    var h = Math.round(mins / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }
  function fmtEventDate(d) {
    // "2026-10-21" -> "21 Oct 2026", "2026-02" -> "Feb 2026"
    var p = d.split("-").map(Number);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (p[2] ? p[2] + " " : "") + months[p[1] - 1] + " " + p[0];
  }
  function latest(s) { return s.sources.map(function (x) { return x.time; }).sort().pop(); }
  function outletsOf(s) {
    var seen = [];
    s.sources.forEach(function (x) { if (seen.indexOf(x.outlet) < 0) seen.push(x.outlet); });
    return seen;
  }

  // ---- Text with key terms --------------------------------------------------
  // Story text marks key terms as [[term-id|shown words]].
  function rich(text, tag, cls) {
    var node = el(tag || "p", cls);
    var re = /\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, last = 0, m;
    while ((m = re.exec(text))) {
      node.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (TERMS[m[1]]) {
        var b = el("button", "term", m[2]);
        b.type = "button";
        b.dataset.term = m[1];
        b.setAttribute("aria-expanded", "false");
        b.setAttribute("aria-controls", "term-pop");
        node.appendChild(b);
      } else {
        node.appendChild(document.createTextNode(m[2]));
      }
      last = re.lastIndex;
    }
    node.appendChild(document.createTextNode(text.slice(last)));
    return node;
  }

  var pop = document.getElementById("term-pop");
  var popFor = null;
  function closePop(returnFocus) {
    if (!popFor) return;
    pop.hidden = true;
    popFor.setAttribute("aria-expanded", "false");
    if (returnFocus) popFor.focus();
    popFor = null;
  }
  function openPop(btn) {
    var t = TERMS[btn.dataset.term];
    if (popFor === btn) { closePop(true); return; }
    closePop(false);
    document.getElementById("term-pop-title").textContent = t.term;
    document.getElementById("term-pop-def").textContent = t.definition;
    document.getElementById("term-pop-link").href = "#term-" + btn.dataset.term;
    pop.hidden = false;
    var r = btn.getBoundingClientRect();
    var w = pop.offsetWidth;
    var left = Math.min(Math.max(16, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - w - 16);
    pop.style.left = left + "px";
    pop.style.top = (r.bottom + window.scrollY + 8) + "px";
    btn.setAttribute("aria-expanded", "true");
    popFor = btn;
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button.term");
    if (b) { openPop(b); return; }
    if (popFor && !pop.contains(e.target)) closePop(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && popFor) closePop(true);
  });
  document.getElementById("term-pop-link").addEventListener("click", function () { closePop(false); });

  // ---- Building blocks ------------------------------------------------------
  function dateline(s) {
    var d = el("div", "dl");
    d.appendChild(el("span", "city", s.city));
    var l = el("span", "local num", localTime(s.tz));
    l.dataset.tz = s.tz === null ? "null" : s.tz;
    d.appendChild(l);
    return d;
  }

  function sourcesBlock(s) {
    var outs = outletsOf(s);
    var det = el("details", "sources");
    det.appendChild(el("summary", null,
      (outs.length > 1 ? "Reported by " + outs.length + " outlets: " : "Reported by ") + outs.join(", ") +
      ". Latest " + ago(latest(s)) + ". " + (s.sources.length > 1 ? "See all " + s.sources.length + " reports" : "Read the report")));
    var ul = el("ul");
    s.sources.forEach(function (x) {
      var li = el("li");
      li.appendChild(link(x.title, x.url));
      li.appendChild(el("span", "num", "  " + x.outlet + ", " + ago(x.time)));
      ul.appendChild(li);
    });
    det.appendChild(ul);
    return det;
  }

  function whyBlock(s, open) {
    if (!s.background) return null;
    var det = el("details", "why");
    if (open) det.open = true;
    det.appendChild(el("summary", null, "How we got here"));
    var box = el("div", "text");
    box.appendChild(rich(s.background));
    if (s.thread && THREADS[s.thread]) {
      var f = el("p", "follow");
      f.appendChild(document.createTextNode("Follow the timeline: "));
      f.appendChild(link(THREADS[s.thread].title, "#thread-" + s.thread));
      box.appendChild(f);
    }
    det.appendChild(box);
    return det;
  }

  function metaLine(s) {
    return el("p", "meta", s.topic + (s.region !== "Global" ? ", " + s.region : ""));
  }

  function storyBody(container, s, headTag, openWhy) {
    container.appendChild(el(headTag, null, s.title));
    container.appendChild(rich(s.summary, "p", "sum"));
    var w = whyBlock(s, openWhy);
    if (w) container.appendChild(w);
    container.appendChild(sourcesBlock(s));
  }

  // ---- Sections -------------------------------------------------------------
  function renderHero() {
    var snap = new Date(D.snapshot);
    var dateStr = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(snap);
    var timeStr = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(snap);
    document.getElementById("intro").textContent =
      dateStr + ". " + D.stories.length + " stories from " + D.outlets.slice(0, -1).join(", ") + " and " + D.outlets.slice(-1) +
      ", explained: where they're happening, how we got here, and what the words mean.";
    document.getElementById("footer-stamp").textContent = "Last updated " + dateStr + " at " + timeStr + " UTC.";
    var hoursOld = (Date.now() - snap.getTime()) / 3600000;
    if (hoursOld > 30) {
      var st = document.getElementById("stale");
      st.hidden = false;
      st.textContent = "These stories were gathered " + Math.round(hoursOld / 24) + " days ago, so some may have moved on. Follow the links for the latest reporting.";
    }
    var clocks = document.getElementById("clocks");
    D.stories.filter(function (s) { return s.lead && s.tz && s.tz !== "UTC"; }).forEach(function (s) {
      var c = el("div", "clock");
      var t = el("span", "t num", shortTime(s.tz));
      t.dataset.short = s.tz;
      c.appendChild(t);
      c.appendChild(el("span", "c", "in " + s.city));
      clocks.appendChild(c);
    });
  }

  function renderLead() {
    var lead = document.getElementById("lead");
    var side = el("div", "side");
    D.stories.filter(function (s) { return s.lead; }).forEach(function (s) {
      var a = el("article", s.lead === "main" ? "main" : null);
      a.id = "s-" + s.id;
      a.appendChild(dateline(s));
      storyBody(a, s, "h2", s.lead === "main");
      if (s.lead === "main") lead.appendChild(a); else side.appendChild(a);
    });
    lead.appendChild(side);
  }

  function renderMap() {
    var M = window.WRN_MAP;
    var box = document.getElementById("map-box");
    if (!M) { box.hidden = true; return; }
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + M.w + " " + M.h);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "World map of today's stories");
    var land = document.createElementNS(NS, "path");
    land.setAttribute("class", "land");
    land.setAttribute("d", M.land);
    land.setAttribute("aria-hidden", "true");
    svg.appendChild(land);

    var tip = el("div", "map-tip");
    tip.hidden = true;
    var placed = 0, unplaced = [];
    // Several stories can share a city; nudge repeats so each dot stays clickable.
    var seen = {};
    D.stories.forEach(function (s) {
      if (s.lat == null || s.lon == null) { if (unplaced.indexOf(s.city) < 0) unplaced.push(s.city); return; }
      var key = s.lat + "," + s.lon;
      var n = seen[key] = (seen[key] || 0) + 1;
      var x = (s.lon + 180) * M.k + (n - 1) * 14;
      var y = (M.top - s.lat) * M.k;
      var a = document.createElementNS(NS, "a");
      a.setAttribute("href", "#s-" + s.id);
      a.setAttribute("class", "dot");
      a.setAttribute("aria-label", s.city + ": " + s.title);
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", x.toFixed(1));
      c.setAttribute("cy", y.toFixed(1));
      c.setAttribute("r", s.lead ? 8 : 6);
      a.appendChild(c);
      function show() {
        var r = box.getBoundingClientRect(), cr = c.getBoundingClientRect();
        tip.textContent = s.city + ": " + s.title;
        tip.style.left = (cr.left + cr.width / 2 - r.left) + "px";
        tip.style.top = (cr.top - r.top) + "px";
        tip.hidden = false;
      }
      a.addEventListener("mouseenter", show);
      a.addEventListener("focus", show);
      a.addEventListener("mouseleave", function () { tip.hidden = true; });
      a.addEventListener("blur", function () { tip.hidden = true; });
      a.addEventListener("click", function () {
        // Make sure the story is visible even if filters would hide it.
        if (!s.lead && (state.region !== "All" || state.topic !== "All")) {
          state = { region: "All", topic: "All" }; save(); renderList();
        }
      });
      svg.appendChild(a);
      placed++;
    });
    box.appendChild(svg);
    box.appendChild(tip);
    document.getElementById("map-note").textContent =
      placed + " stories on the map." + (unplaced.length ? " Not shown, because they have no single location: " + unplaced.join(", ") + "." : "");
  }

  // Filters + list
  var REGIONS = ["All", "Europe", "Middle East", "Africa", "Asia-Pacific", "Americas", "Global"];
  var rows = {};
  function save() { try { localStorage.setItem("wrn-filters", JSON.stringify(state)); } catch (e) {} }

  function buildFilters() {
    var topics = ["All"];
    D.stories.forEach(function (s) { if (topics.indexOf(s.topic) < 0) topics.push(s.topic); });
    function count(key, val) {
      return D.stories.filter(function (s) { return val === "All" || s[key] === val; }).length;
    }
    function buildRow(id, key, vals) {
      var row = document.getElementById(id);
      vals.forEach(function (v) {
        var n = count(key, v);
        if (!n) return;
        var b = el("button", "chip", v);
        b.type = "button";
        b.appendChild(el("span", "count num", String(n)));
        b.dataset.val = v;
        b.onclick = function () { state[key] = v; save(); renderList(); };
        row.appendChild(b);
      });
    }
    buildRow("f-region", "region", REGIONS);
    buildRow("f-topic", "topic", topics);
    if (REGIONS.indexOf(state.region) < 0) state.region = "All";
    if (topics.indexOf(state.topic) < 0) state.topic = "All";

    D.stories.forEach(function (s) {
      var a = el("article", "story");
      if (!s.lead) a.id = "s-" + s.id;
      a.appendChild(dateline(s));
      var body = el("div", "body");
      body.appendChild(metaLine(s));
      storyBody(body, s, "h3", false);
      a.appendChild(body);
      rows[s.id] = a;
    });
  }

  var listEl = document.getElementById("list");
  var emptyEl = el("p", "empty", "No stories match these filters. Try another region or topic.");
  function renderList() {
    ["f-region", "f-topic"].forEach(function (id) {
      var key = id === "f-region" ? "region" : "topic";
      Array.prototype.forEach.call(document.getElementById(id).querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.val === state[key]));
      });
    });
    var filtered = state.region !== "All" || state.topic !== "All";
    listEl.textContent = "";
    var shown = D.stories
      .filter(function (s) {
        if (!filtered && s.lead) return false;
        return (state.region === "All" || s.region === state.region) && (state.topic === "All" || s.topic === state.topic);
      })
      .sort(function (a, b) { return latest(b) < latest(a) ? -1 : 1; });
    shown.forEach(function (s) { listEl.appendChild(rows[s.id]); });
    if (!shown.length) listEl.appendChild(emptyEl);
  }

  function renderThreads() {
    var wrap = document.getElementById("threads");
    Object.keys(THREADS).forEach(function (id) {
      var t = THREADS[id];
      var a = el("article", "thread");
      a.id = "thread-" + id;
      a.appendChild(el("h3", null, t.title));
      a.appendChild(rich(t.intro));
      var ol = el("ol");
      t.events.forEach(function (ev) {
        var li = el("li");
        var tm = el("time", "num", fmtEventDate(ev.date));
        tm.setAttribute("datetime", ev.date);
        li.appendChild(tm);
        var body = el("div");
        body.appendChild(rich(ev.text));
        if (ev.source) {
          var src = el("p", "src");
          src.appendChild(link(ev.source.outlet, ev.source.url));
          body.appendChild(src);
        }
        li.appendChild(body);
        ol.appendChild(li);
      });
      a.appendChild(ol);
      var today = D.stories.filter(function (s) { return s.thread === id; });
      if (today.length) {
        var p = el("p", "today");
        p.appendChild(document.createTextNode("Today: "));
        today.forEach(function (s, i) {
          if (i) p.appendChild(document.createTextNode("; "));
          p.appendChild(link(s.title, "#s-" + s.id));
        });
        a.appendChild(p);
      }
      wrap.appendChild(a);
    });
  }

  function renderTerms() {
    var dl = document.getElementById("terms");
    Object.keys(TERMS)
      .sort(function (a, b) { return TERMS[a].term.localeCompare(TERMS[b].term); })
      .forEach(function (id) {
        var d = el("div");
        d.id = "term-" + id;
        d.appendChild(el("dt", null, TERMS[id].term));
        d.appendChild(el("dd", null, TERMS[id].definition));
        dl.appendChild(d);
      });
  }

  function renderLighter() {
    var lightEl = document.getElementById("light");
    D.lighter.forEach(function (s) {
      var a = el("article", "item" + (s.big ? " big" : ""));
      a.appendChild(dateline(s));
      a.appendChild(el("h3", null, s.title));
      a.appendChild(rich(s.summary));
      a.appendChild(sourcesBlock(s));
      lightEl.appendChild(a);
    });
  }

  function renderSport() {
    var sportEl = document.getElementById("sport");
    D.sport.forEach(function (x) {
      var r = el("div", "score");
      r.appendChild(el("p", "r num", x.result));
      var n = el("p", "n", x.note + " ");
      n.appendChild(link(x.outlet, x.url));
      r.appendChild(n);
      sportEl.appendChild(r);
    });
  }

  document.getElementById("clear").onclick = function () {
    try { localStorage.removeItem("wrn-filters"); } catch (e) {}
    state = { region: "All", topic: "All" };
    if (D) renderList();
    document.getElementById("cleared").textContent = "Done. This site has nothing saved in your browser now.";
  };

  function tick() {
    Array.prototype.forEach.call(document.querySelectorAll(".local[data-tz]"), function (n) {
      n.textContent = localTime(n.dataset.tz === "null" ? null : n.dataset.tz);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-short]"), function (n) {
      n.textContent = shortTime(n.dataset.short);
    });
  }

  function getJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }

  Promise.all([getJSON("data/latest.json"), getJSON("data/terms.json"), getJSON("data/threads.json")])
    .then(function (res) {
      D = res[0]; TERMS = res[1]; THREADS = res[2];
      renderHero();
      renderLead();
      renderMap();
      buildFilters();
      renderList();
      renderThreads();
      renderTerms();
      renderLighter();
      renderSport();
      setInterval(tick, 30000);
      // Jump to a linked story or term once everything exists.
      if (location.hash) {
        var target = document.getElementById(location.hash.slice(1));
        if (target) target.scrollIntoView();
      }
    })
    .catch(function () {
      var st = document.getElementById("stale");
      st.hidden = false;
      st.textContent = "Today's stories didn't load. Refresh the page to try again.";
    });
})();
