// World Right Now: renders today's edition from the JSON files in data/.
// No libraries and no outside requests. The news is a daily snapshot; local times and
// day-and-night shading are worked out live in the browser from the current time.
(function () {
  "use strict";

  var D, TERMS, THREADS, SOURCES = null;
  var RANKED = [];
  var WIRE = null, wireLoading = null, wireShown = 30;
  var REGIONS = ["All", "Europe", "Middle East", "Africa", "Asia-Pacific", "Americas", "Global"];
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = { region: "All", topic: "All", q: "" };
  try {
    var saved = JSON.parse(localStorage.getItem("wrn-filters") || "null");
    if (saved && saved.region && saved.topic) { state.region = saved.region; state.topic = saved.topic; }
  } catch (e) {}
  function save() {
    try { localStorage.setItem("wrn-filters", JSON.stringify({ region: state.region, topic: state.topic })); } catch (e) {}
  }

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name, cls) {
    var NS = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("class", "ico" + (cls ? " " + cls : ""));
    s.setAttribute("aria-hidden", "true");
    var u = document.createElementNS(NS, "use");
    u.setAttribute("href", "#i-" + name);
    s.appendChild(u);
    return s;
  }
  function link(text, href, cls) {
    var a = el("a", cls, text);
    a.href = href;
    if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }
  function outLink(text, href, cls) {
    var a = link("", href, cls);
    a.appendChild(document.createTextNode(text));
    a.appendChild(icon("out"));
    a.setAttribute("aria-label", text + " (opens the original report)");
    return a;
  }
  function strip(t) { return String(t || "").replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, "$1"); }
  function norm(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim(); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  // Next animation frame, with a timer fallback for background or throttled tabs.
  function frame(cb) {
    var done = false;
    function run() { if (!done) { done = true; cb(performance.now()); } }
    requestAnimationFrame(run);
    setTimeout(run, 40);
  }

  // ---------------------------------------------------------------- time
  function partOfDay(h) {
    if (h < 5) return "night";
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    if (h < 21) return "evening";
    return "night";
  }
  function localTime(tz) {
    if (tz === null || tz === "null") return "No time zone";
    var now = new Date();
    if (tz === "UTC") return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(now) + " UTC";
    try {
      var t = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(now).toLowerCase();
      var h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
      return t + " · " + partOfDay(h);
    } catch (e) { return ""; }
  }
  function shortTime(tz) {
    try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date()).toLowerCase(); }
    catch (e) { return ""; }
  }
  function utcNow() { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date()); }
  function ago(iso) {
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return Math.max(mins, 1) + " min ago";
    var h = Math.round(mins / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }
  function fmtEventDate(d) {
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

  // ---------------------------------------------------------------- the sun
  // Approximate subsolar point (good to about a degree), enough for day/night shading.
  var RAD = Math.PI / 180;
  function subsolar(date) {
    var start = Date.UTC(date.getUTCFullYear(), 0, 0);
    var n = (date.getTime() - start) / 86400000;
    var g = 2 * Math.PI / 365 * (n - 1);
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    var lon = -(utcMin + eot - 720) / 4;
    lon = ((lon + 540) % 360) - 180;
    return { lat: decl / RAD, lon: lon };
  }
  function sunSin(lat, lon, ss) {
    return Math.sin(lat * RAD) * Math.sin(ss.lat * RAD) + Math.cos(lat * RAD) * Math.cos(ss.lat * RAD) * Math.cos((lon - ss.lon) * RAD);
  }

  // ---------------------------------------------------------------- key terms in text
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

  var pop = $("term-pop");
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
    $("term-pop-title").textContent = t.term;
    $("term-pop-def").textContent = t.definition;
    $("term-pop-link").href = "#term-" + btn.dataset.term;
    pop.hidden = false;
    var r = btn.getBoundingClientRect();
    var w = pop.offsetWidth;
    var left = Math.min(Math.max(16, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - w - 16);
    pop.style.left = left + "px";
    pop.style.top = (r.bottom + window.scrollY + 10) + "px";
    btn.setAttribute("aria-expanded", "true");
    popFor = btn;
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button.term");
    if (b) { e.stopPropagation(); openPop(b); return; }
    if (popFor && !pop.contains(e.target)) closePop(false);
  });
  $("term-pop-link").addEventListener("click", function (e) {
    var id = this.getAttribute("href").slice(1);
    closePop(false);
    e.preventDefault();
    showTerm(id);
  });

  // ---------------------------------------------------------------- ranking and search
  // Top stories: the day's lead stories as chosen in the daily update, then the stories
  // covered by the most outlets, then the most reports, then the most recent.
  function score(s) {
    var lead = s.lead === "main" ? 3 : s.lead === "side" ? 2 : 0;
    return lead * 1e6 + outletsOf(s).length * 1e4 + s.sources.length * 1e2 + new Date(latest(s)).getTime() / 1e11;
  }
  function placeFields(s) {
    return [s.city, s.state, s.country].concat(s.places || []).filter(Boolean).map(norm);
  }
  function textOf(s) {
    return norm([s.title, strip(s.summary), strip(s.background), s.topic, s.region].join(" "));
  }
  // 2: the place matches, 1: the words appear in the story, 0: no match
  function matchLevel(s, q) {
    if (!q) return 2;
    var places = placeFields(s);
    for (var i = 0; i < places.length; i++) {
      if (places[i] === q || places[i].indexOf(q) === 0 || (q.length > 3 && places[i].indexOf(q) >= 0)) return 2;
    }
    if (norm(s.region) === q) return 2;
    return textOf(s).indexOf(q) >= 0 ? 1 : 0;
  }
  function filtering() { return !!(state.q || state.region !== "All" || state.topic !== "All"); }
  function results() {
    var q = norm(state.q);
    return RANKED
      .map(function (s) { return { s: s, m: matchLevel(s, q) }; })
      .filter(function (r) {
        // Without a search or filter, local stories live in their own section below.
        if (!filtering() && r.s.scale === "local") return false;
        return r.m > 0 && (state.region === "All" || r.s.region === state.region) && (state.topic === "All" || r.s.topic === state.topic);
      })
      .sort(function (a, b) { return b.m - a.m || score(b.s) - score(a.s); })
      .map(function (r) { return r.s; });
  }

  // ---------------------------------------------------------------- shared story parts
  function dateline(s, opts) {
    var d = el(opts && opts.inline ? "span" : "p", "dl");
    d.appendChild(el("span", "city", s.city));
    var where = [s.state, s.country].filter(function (x) { return x && x !== s.city && x !== "Worldwide"; }).join(", ");
    if (where && !(opts && opts.short)) d.appendChild(el("span", "where", where));
    var l = el("span", "local num", localTime(s.tz));
    l.dataset.tz = s.tz === null ? "null" : s.tz;
    d.appendChild(l);
    return d;
  }
  function metaLine(s, inline) {
    var m = el(inline ? "span" : "p", "meta");
    var n = outletsOf(s).length;
    m.appendChild(el("span", null, s.topic));
    m.appendChild(el("span", null, n > 1 ? n + " outlets" : outletsOf(s)[0]));
    m.appendChild(el("span", "num", "Latest " + ago(latest(s))));
    return m;
  }
  function chev() { return icon("chev"); }
  function whyBlock(s, open) {
    if (!s.background) return null;
    var det = el("details", "why");
    if (open) det.open = true;
    var sum = el("summary");
    sum.appendChild(document.createTextNode("How we got here"));
    sum.appendChild(chev());
    det.appendChild(sum);
    var box = el("div", "why-text");
    box.appendChild(rich(s.background));
    if (s.thread && THREADS[s.thread]) {
      var f = link("", "#thread-" + s.thread, "follow");
      f.appendChild(document.createTextNode("Timeline: " + THREADS[s.thread].title));
      f.appendChild(icon("arrow"));
      box.appendChild(f);
    }
    det.appendChild(box);
    return det;
  }
  function sourcesBlock(s) {
    var outs = outletsOf(s);
    var det = el("details", "sources");
    var sum = el("summary");
    sum.appendChild(document.createTextNode(
      (s.sources.length > 1 ? s.sources.length + " original reports" : "Original report") + " · " + outs.join(", ")));
    sum.appendChild(chev());
    det.appendChild(sum);
    var ul = el("ul", "src-list");
    s.sources.forEach(function (x) {
      var li = el("li");
      li.appendChild(outLink(x.title, x.url));
      li.appendChild(el("span", "src-meta num", x.outlet + " · " + ago(x.time)));
      ul.appendChild(li);
    });
    det.appendChild(ul);
    return det;
  }

  // Location inset: a crop of the NASA Earth image around the story's place, lit as it is now.
  var insets = [];
  function inset(s, span) {
    if (s.lat == null || s.lon == null) {
      var none = el("div", "inset inset-none");
      none.appendChild(icon(/moon/i.test(s.city) ? "moon" : "globe"));
      none.appendChild(el("span", "none-label", s.city === "Worldwide" ? "A worldwide story" : "No single place on Earth"));
      return none;
    }
    var box = el("div", "inset");
    box.dataset.lat = s.lat; box.dataset.lon = s.lon; box.dataset.span = span;
    box.setAttribute("role", "img");
    box.appendChild(el("span", "here"));
    var chip = el("span", "light");
    box.appendChild(chip);
    insets.push(box);
    paintInset(box);
    return box;
  }
  function paintInset(box) {
    var lat = +box.dataset.lat, lon = +box.dataset.lon, span = +box.dataset.span;
    var night = sunSin(lat, lon, subsolar(new Date())) < -0.03;
    var W = box.clientWidth || 600, H = box.clientHeight || 340;
    var k = 360 / span, Wi = W * k, Hi = Wi / 2;
    var x = W / 2 - (lon + 180) / 360 * Wi;
    var y = Math.min(0, Math.max(H - Hi, H / 2 - (90 - lat) / 180 * Hi));
    box.style.backgroundImage = "url(assets/img/" + (night ? "earth-night" : "earth-day") + ".jpg)";
    box.style.backgroundSize = Wi.toFixed(0) + "px " + Hi.toFixed(0) + "px";
    box.style.backgroundPosition = x.toFixed(1) + "px " + y.toFixed(1) + "px";
    box.style.backgroundRepeat = "repeat-x";
    var chip = box.querySelector(".light");
    chip.textContent = "";
    chip.appendChild(icon(night ? "moon" : "sun"));
    chip.appendChild(document.createTextNode(night ? "Night there now" : "Daylight there now"));
    box.setAttribute("aria-label", "Satellite view around this place, " + (night ? "at night" : "in daylight") + " right now");
  }

  // ---------------------------------------------------------------- hero
  function renderHero() {
    var snap = new Date(D.snapshot);
    var day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(snap);
    var time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(snap);
    $("edition-text").textContent = "Daily edition · " + day + " · gathered " + time + " UTC";
    $("footer-stamp").textContent = "This edition was gathered on " + day + " at " + time + " UTC. A new one is published every morning.";
    var hours = (Date.now() - snap.getTime()) / 3600000;
    if (hours > 30) {
      var st = $("stale");
      st.hidden = false;
      st.textContent = "This edition was gathered " + Math.round(hours / 24) + " days ago, so some stories may have moved on. Follow the links for the latest reporting.";
    }

    // Example searches taken from today's own stories.
    // One big story's place, then places from the local stories in two different regions.
    var picks = [];
    var top = RANKED[0];
    if (top) picks.push(top.city);
    var locals = RANKED.filter(function (s) { return s.scale === "local" && s.lat != null; });
    var seenRegion = {};
    locals.forEach(function (s) {
      if (picks.length >= 3 || seenRegion[s.region]) return;
      var name = (s.places && s.places[0]) || s.city.split(",")[0];
      if (picks.indexOf(name) >= 0) return;
      seenRegion[s.region] = 1;
      picks.push(name);
    });
    var hint = $("hint");
    hint.textContent = "";
    if (picks.length) {
      hint.appendChild(document.createTextNode("Try "));
      picks.forEach(function (p, i) {
        if (i) hint.appendChild(document.createTextNode(i === picks.length - 1 ? " or " : ", "));
        var b = el("button", null, p);
        b.type = "button";
        b.addEventListener("click", function () { runSearch(p, true); });
        hint.appendChild(b);
      });
    }

    // Numbers, all counted from today's data.
    var outlets = {};
    var countries = {};
    D.stories.forEach(function (s) {
      s.sources.forEach(function (x) { outlets[x.outlet] = 1; });
      if (s.country && s.country !== "Worldwide") countries[s.country] = 1;
    });
    var read = SOURCES ? SOURCES.feeds.reduce(function (m, f) { m[f.outlet] = 1; return m; }, {}) : outlets;
    var stats = [
      [D.stories.length, "Stories today"],
      [D.stories.filter(function (s) { return s.scale === "local"; }).length, "Local stories"],
      [Object.keys(countries).length, "Countries and territories"],
      [Object.keys(read).length, "News outlets read"],
    ];
    var dlEl = $("stats");
    stats.forEach(function (x) {
      var d = el("div");
      d.appendChild(el("dt", null, x[1]));
      d.appendChild(el("dd", null, String(x[0])));
      dlEl.appendChild(d);
    });
  }

  // The live Earth: NASA day and night imagery blended along today's terminator.
  var earth = { day: null, night: null, comp: null, at: 0 };
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = rej;
      i.src = src;
    });
  }
  function buildComposite() {
    var W = earth.day.naturalWidth, H = earth.day.naturalHeight;
    var ss = subsolar(new Date());
    var mw = 512, mh = 256;
    var mask = document.createElement("canvas");
    mask.width = mw; mask.height = mh;
    var mctx = mask.getContext("2d");
    var img = mctx.createImageData(mw, mh);
    for (var y = 0; y < mh; y++) {
      var lat = 90 - (y + 0.5) / mh * 180;
      for (var x = 0; x < mw; x++) {
        var lon = -180 + (x + 0.5) / mw * 360;
        var a = Math.max(0, Math.min(1, (0.1 - sunSin(lat, lon, ss)) / 0.2));
        var i = (y * mw + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    mctx.putImageData(img, 0, 0);
    var night = document.createElement("canvas");
    night.width = W; night.height = H;
    var nctx = night.getContext("2d");
    nctx.drawImage(earth.night, 0, 0, W, H);
    nctx.globalCompositeOperation = "destination-in";
    nctx.imageSmoothingEnabled = true;
    nctx.drawImage(mask, 0, 0, W, H);
    var comp = document.createElement("canvas");
    comp.width = W; comp.height = H;
    var cctx = comp.getContext("2d");
    cctx.drawImage(earth.day, 0, 0, W, H);
    // Dim the daylit side a touch so the page stays dark and the night lights carry.
    cctx.fillStyle = "rgba(8, 9, 13, 0.28)";
    cctx.fillRect(0, 0, W, H);
    cctx.drawImage(night, 0, 0);
    earth.comp = comp;
    earth.at = Date.now();
  }
  // When someone clicks the Earth it zooms to {lat, lon, span}; null means the whole-world view.
  earth.zoom = null;
  function earthView() {
    var base = baseEarthView();
    var z = earth.zoom;
    if (!z) return base;
    var lonSpan = Math.min(360, z.span);
    var latSpan = Math.min(180, lonSpan * base.H / base.W);
    var latTop = Math.max(-90 + latSpan, Math.min(90, z.lat + latSpan / 2));
    return { W: base.W, H: base.H, lon0: z.lon - lonSpan / 2, lonSpan: lonSpan, latTop: latTop, latSpan: latSpan, zoomed: true };
  }
  function viewCenter(v) {
    return { lon: v.lon0 + v.lonSpan / 2, lat: v.latTop - v.latSpan / 2, span: v.lonSpan };
  }
  function zoomEarth(lat, lon, span) {
    var from = viewCenter(earthView());
    var to = span ? { lat: lat, lon: lon, span: span } : null;
    var target = to || viewCenter(baseEarthView());
    // Go the short way round the globe.
    var dLon = ((target.lon - from.lon + 540) % 360) - 180;
    var t0 = performance.now(), dur = reduceMotion ? 0 : 700;
    function step(now) {
      var t = dur ? Math.min(1, (now - t0) / dur) : 1;
      var e = 1 - Math.pow(1 - t, 3);
      earth.zoom = {
        lat: from.lat + (target.lat - from.lat) * e,
        lon: from.lon + dLon * e,
        span: from.span * Math.pow(target.span / from.span, e),
      };
      if (t >= 1) earth.zoom = to;
      drawEarth();
      if (t < 1) frame(step);
    }
    frame(step);
    $("earth-back").hidden = !to;
  }
  function baseEarthView() {
    var stage = $("earth-stage");
    var W = stage.clientWidth, H = stage.clientHeight;
    var latTop = 78, latBot = -58, latSpan = latTop - latBot;
    var lonSpan = latSpan * W / H;
    var center = 10;
    if (lonSpan >= 360) {
      lonSpan = 360;
      latSpan = 360 * H / W;
      latTop = 10 + latSpan / 2;
      latBot = latTop - latSpan;
    } else {
      // On narrow screens, centre on the top stories.
      var pts = RANKED.slice(0, 3).filter(function (s) { return s.lon != null; });
      if (pts.length) {
        var sx = 0, sy = 0;
        pts.forEach(function (s) { sx += Math.cos(s.lon * RAD); sy += Math.sin(s.lon * RAD); });
        center = Math.atan2(sy, sx) / RAD;
      }
    }
    return { W: W, H: H, lon0: lonSpan >= 360 ? -180 : center - lonSpan / 2, lonSpan: lonSpan, latTop: latTop, latSpan: latSpan };
  }
  function drawEarth() {
    if (!earth.comp) return;
    var v = earthView();
    var canvas = $("earth-canvas");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(v.W * dpr);
    canvas.height = Math.round(v.H * dpr);
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    var cw = earth.comp.width, ch = earth.comp.height;
    var sy = (90 - v.latTop) / 180 * ch, sh = v.latSpan / 180 * ch;
    var lon0 = ((v.lon0 + 180) % 360 + 360) % 360; // 0..360 from the left edge of the image
    var sx = lon0 / 360 * cw, sw = v.lonSpan / 360 * cw;
    var first = Math.min(sw, cw - sx);
    var dW = canvas.width, dH = canvas.height;
    ctx.drawImage(earth.comp, sx, sy, first, sh, 0, 0, dW * first / sw, dH);
    if (first < sw) ctx.drawImage(earth.comp, 0, sy, sw - first, sh, dW * first / sw, 0, dW * (sw - first) / sw, dH);
    placePins(v);
  }
  function placePins(v) {
    var wrap = $("earth-pins");
    wrap.textContent = "";
    var placed = [];
    function pos(s) {
      var dx = ((s.lon - v.lon0) % 360 + 360) % 360;
      if (dx > v.lonSpan) return null;
      var x = dx / v.lonSpan * v.W, y = (v.latTop - s.lat) / v.latSpan * v.H;
      return y < 10 || y > v.H - 10 ? null : { x: x, y: y };
    }
    // Whole world: the top three stories. Zoomed in: every story in view, labelled nearest the centre first.
    var list;
    if (v.zoomed) {
      var c = viewCenter(v);
      list = RANKED.filter(function (s) { return s.lat != null && pos(s); })
        .sort(function (a, b) { return km(c.lat, c.lon, a.lat, a.lon) - km(c.lat, c.lon, b.lat, b.lon); });
    } else {
      list = RANKED.slice(0, 3).filter(function (s) { return s.lat != null && pos(s); });
    }
    list.forEach(function (s, i) {
      var p = pos(s);
      var a = link("", "#s-" + s.id, "pin" + (v.zoomed && i >= 5 ? " pin-quiet" : ""));
      a.style.left = p.x + "px";
      a.style.top = p.y + "px";
      a.appendChild(el("span", "pin-dot"));
      var lab = el("span", "pin-label");
      lab.appendChild(el("b", null, s.city));
      var t = el("span", "num", shortTime(s.tz) + " there");
      t.dataset.short = s.tz;
      lab.appendChild(t);
      a.appendChild(lab);
      a.setAttribute("aria-label", s.city + ": " + s.title);
      a.title = s.city + ": " + s.title;
      a.addEventListener("click", function (e) { e.preventDefault(); showStory(s.id); });
      wrap.appendChild(a);
      placed.push({ a: a, lab: lab, x: p.x });
    });
    // Labels must not cover another label or another pin's dot.
    var boxes = placed.map(function (q) { return q.a.querySelector(".pin-dot").getBoundingClientRect(); });
    placed.forEach(function (q) {
      if (q.a.classList.contains("pin-quiet")) return;
      var a = q.a, lab = q.lab, x = q.x;
      // Keep labels apart: try the preferred side, the other side, then a little above or below.
      var prefer = x > v.W * 0.62;
      var h = lab.getBoundingClientRect().height;
      var options = [[prefer, 0], [!prefer, 0], [prefer, -0.7], [!prefer, -0.7], [prefer, 0.7], [!prefer, 0.7]];
      var own = a.querySelector(".pin-dot").getBoundingClientRect();
      function hit() {
        var b = lab.getBoundingClientRect();
        return boxes.some(function (o) {
          if (o.left === own.left && o.top === own.top) return false;
          return !(b.right + 6 < o.left || b.left - 6 > o.right || b.bottom + 4 < o.top || b.top - 4 > o.bottom);
        });
      }
      var fits = false;
      for (var i = 0; i < options.length && !fits; i++) {
        a.classList.toggle("flip", options[i][0]);
        lab.style.transform = options[i][1] ? "translateY(" + (options[i][1] * h) + "px)" : "";
        fits = !hit();
      }
      // Where there's no free space (stories close together), keep just the dot; its name shows on hover.
      if (!fits && v.zoomed) { a.classList.add("pin-quiet"); return; }
      boxes.push(lab.getBoundingClientRect());
    });
  }
  function startEarth() {
    var fig = $("earth");
    Promise.all([loadImg("assets/img/earth-day.jpg"), loadImg("assets/img/earth-night.jpg")]).then(function (imgs) {
      earth.day = imgs[0]; earth.night = imgs[1];
      buildComposite();
      drawEarth();
      frame(function () { fig.classList.add("is-ready"); });
      $("earth-cap").textContent = "Daylight and darkness across the Earth at " + utcNow() + " UTC, worked out from the current time and drawn with NASA imagery. Markers show today's top three stories. Click anywhere to zoom in and see the stories around it.";
      var stage = $("earth-stage");
      stage.addEventListener("click", function (e) {
        if (e.target.closest(".pin, .earth-back")) return;
        var v = earthView(), r = stage.getBoundingClientRect();
        var lon = v.lon0 + (e.clientX - r.left) / r.width * v.lonSpan;
        var lat = v.latTop - (e.clientY - r.top) / r.height * v.latSpan;
        lon = ((lon + 540) % 360) - 180;
        zoomEarth(lat, lon, v.zoomed ? Math.max(12, v.lonSpan / 1.8) : 44);
        showNearby(lat, lon, "nearby-hero");
      });
      $("earth-back").addEventListener("click", function () {
        zoomEarth(0, 0, null);
        $("nearby-hero").hidden = true;
      });
    }).catch(function () {
      fig.hidden = true;
    });
  }

  // ---------------------------------------------------------------- stories near a point
  function km(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  var fmtKm = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  function showNearby(lat, lon, id) {
    var box = $(id);
    box.textContent = "";
    box.hidden = false;
    var near = RANKED.filter(function (s) { return s.lat != null; })
      .map(function (s) { return { s: s, d: km(lat, lon, s.lat, s.lon) }; })
      .sort(function (a, b) { return a.d - b.d; });
    var within = near.filter(function (n) { return n.d <= 1500; }).slice(0, 12);
    // Name the area after the nearest story, if it's close enough to be fair.
    var first = near[0];
    var area = first && first.d < 800 ? [first.s.state, first.s.country].filter(function (x) { return x && x !== "Worldwide"; }).join(", ") : "";
    var head = el("div", "nearby-head");
    head.appendChild(el("h3", null, area ? "Around " + area : "Around " + Math.abs(lat).toFixed(0) + "°" + (lat >= 0 ? "N" : "S") + ", " + Math.abs(lon).toFixed(0) + "°" + (lon >= 0 ? "E" : "W")));
    var close = el("button", "icon-btn");
    close.type = "button";
    close.setAttribute("aria-label", "Close stories around here");
    close.appendChild(icon("x"));
    close.addEventListener("click", function () {
      box.hidden = true;
      if (id === "nearby-hero") zoomEarth(0, 0, null);
    });
    head.appendChild(close);
    box.appendChild(head);
    box.appendChild(el("p", "nearby-sub", within.length
      ? within.length + (within.length === 1 ? " story" : " stories") + " in today's edition within 1,500 km, nearest first."
      : "No stories in today's edition within 1,500 km of here." + (first ? " The nearest is in " + first.s.city + ", " + fmtKm.format(first.d) + " km away." : "")));
    var ul = el("ul", "nearby-list");
    (within.length ? within : near.slice(0, 1)).forEach(function (n) {
      var li = el("li");
      var b = el("button", "nearby-item");
      b.type = "button";
      var top = el("span", "nearby-where");
      top.appendChild(el("span", "city", n.s.city));
      top.appendChild(el("span", "num", n.d < 10 ? "right here" : fmtKm.format(n.d) + " km away"));
      if (n.s.scale === "local") top.appendChild(el("span", "tag", "Local"));
      b.appendChild(top);
      b.appendChild(el("span", "nearby-title", n.s.title));
      b.addEventListener("click", function () { showStory(n.s.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    // Offer the week's headlines for the country, which reach places the edition doesn't.
    var country = first && first.d < 800 ? first.s.country : "";
    if (country && country !== "Worldwide") {
      var more = el("button", "btn btn-ghost", "Search this week's headlines from " + country);
      more.type = "button";
      more.addEventListener("click", function () { runSearch(country, true); });
      box.appendChild(more);
    }
  }

  // ---------------------------------------------------------------- stories
  function featureCard(s, kind, n) {
    var a = el("article", "feature rv " + kind);
    a.id = "s-" + s.id;
    a.appendChild(inset(s, kind === "is-main" ? 34 : 40));
    // The badge says why the story is up top, using only what the data shows.
    var outs = outletsOf(s);
    var unfiltered = !state.q && state.region === "All" && state.topic === "All";
    var why = unfiltered && s.lead === "main" ? "Lead story" : unfiltered && s.lead ? "Top story" : "";
    var cover = outs.length > 1 ? outs.length + " outlets" : outs[0];
    a.appendChild(el("span", "rank", why ? why + " · " + cover : "Covered by " + cover));
    var b = el("div", "feature-body");
    b.appendChild(dateline(s));
    b.appendChild(el("h3", null, s.title));
    b.appendChild(rich(s.summary, "p", "sum"));
    b.appendChild(metaLine(s));
    var w = whyBlock(s, kind === "is-main" && window.innerWidth > 720);
    if (w) b.appendChild(w);
    b.appendChild(sourcesBlock(s));
    a.appendChild(b);
    return a;
  }
  function row(s, full) {
    var li = el("li", "row");
    li.id = "s-" + s.id;
    var head = el("button", "row-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    head.setAttribute("aria-controls", "rb-" + s.id);
    head.appendChild(dateline(s, { short: !full, inline: true }));
    head.appendChild(el("span", "row-title", s.title));
    head.appendChild(metaLine(s, true));
    head.appendChild(chev());
    var body = el("div", "row-body");
    body.id = "rb-" + s.id;
    body.hidden = true;
    var where = [s.state, s.country].filter(function (x) { return x && x !== s.city && x !== "Worldwide"; }).join(", ");
    if (where && !full) body.appendChild(el("p", "meta", where));
    body.appendChild(rich(s.summary, "p", "sum"));
    var w = whyBlock(s, false);
    if (w) body.appendChild(w);
    body.appendChild(sourcesBlock(s));
    head.addEventListener("click", function () { toggleRow(li); });
    li.appendChild(head);
    li.appendChild(body);
    return li;
  }
  function toggleRow(li, open) {
    var head = li.querySelector(".row-head");
    var body = li.querySelector(".row-body");
    var to = open == null ? head.getAttribute("aria-expanded") !== "true" : open;
    head.setAttribute("aria-expanded", String(to));
    body.hidden = !to;
  }

  function renderStories() {
    insets = insets.filter(function (b) { return document.body.contains(b) && !b.closest("#featured"); });
    var list = results();
    var featured = $("featured");
    var more = $("more");
    featured.textContent = "";
    more.textContent = "";
    var top = list.slice(0, 3), rest = list.slice(3);
    top.forEach(function (s, i) {
      var kind = top.length === 1 ? "is-solo" : top.length === 2 ? "is-pair" : i === 0 ? "is-main" : "is-side";
      featured.appendChild(featureCard(s, kind, i));
    });
    rest.forEach(function (s) { more.appendChild(row(s)); });
    $("more-wrap").hidden = !rest.length;
    $("more-h").textContent = state.q || state.region !== "All" || state.topic !== "All" ? "More matching stories" : "More stories";

    // Status line
    var st = $("status");
    st.textContent = "";
    var filtered = state.q || state.region !== "All" || state.topic !== "All";
    if (!list.length) {
      var e = el("p", "empty");
      e.textContent = state.q
        ? "No stories in today's edition mention “" + state.q + "”" + (state.region !== "All" || state.topic !== "All" ? " with these filters" : "") + ". Check the week's headlines and the wider search below, or try the nearest city, district or state."
        : "No stories match these filters today.";
      featured.appendChild(e);
    }
    var p = el("p");
    var strong = el("strong", "num", String(list.length));
    p.appendChild(strong);
    p.appendChild(document.createTextNode(list.length === 1 ? " story" : " stories"));
    var bits = [];
    if (state.q) bits.push("for “" + state.q + "”");
    if (state.region !== "All") bits.push("in " + state.region);
    if (state.topic !== "All") bits.push("about " + state.topic.toLowerCase());
    if (bits.length) p.appendChild(document.createTextNode(" " + bits.join(" ")));
    p.appendChild(document.createTextNode(list.length > 3 ? ". Top three first, ranked by lead stories and how many outlets covered them." : "."));
    st.appendChild(p);
    if (filtered) {
      var c = el("button", "btn-link", "Clear search and filters");
      c.type = "button";
      c.addEventListener("click", function () { clearAll(); });
      st.appendChild(c);
    }

    ["f-region", "f-topic"].forEach(function (id) {
      var key = id === "f-region" ? "region" : "topic";
      Array.prototype.forEach.call($(id).querySelectorAll(".chip"), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.val === state[key]));
      });
    });
    $("clear-q").hidden = !state.q;
    renderLocal();
    renderWire();
    renderWider();
    reveal();
    // Position the location pictures now that they have their real size.
    frame(function () { insets.forEach(paintInset); });
  }
  function clearAll() {
    state.q = ""; state.region = "All"; state.topic = "All";
    $("q").value = ""; $("hero-q").value = "";
    save();
    renderStories();
  }
  function runSearch(q, scroll) {
    state.q = q.trim();
    $("q").value = state.q;
    $("hero-q").value = state.q;
    renderStories();
    if (scroll) $("today").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }
  function showStory(id) {
    var node = $("s-" + id);
    if (!node) { clearAll(); node = $("s-" + id); }
    if (!node) return;
    if (node.classList.contains("row")) toggleRow(node, true);
    node.classList.add("is-in");
    node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    var focusable = node.querySelector(".row-head") || node.querySelector("h3");
    if (focusable) {
      if (!focusable.hasAttribute("tabindex") && focusable.tagName === "H3") focusable.setAttribute("tabindex", "-1");
      setTimeout(function () { focusable.focus({ preventScroll: true }); }, reduceMotion ? 0 : 450);
    }
  }

  function buildControls() {
    var topics = ["All"];
    D.stories.forEach(function (s) { if (topics.indexOf(s.topic) < 0) topics.push(s.topic); });
    if (REGIONS.indexOf(state.region) < 0) state.region = "All";
    if (topics.indexOf(state.topic) < 0) state.topic = "All";
    function count(key, val) { return D.stories.filter(function (s) { return val === "All" || s[key] === val; }).length; }
    function build(id, key, vals) {
      var wrap = $(id);
      vals.forEach(function (v) {
        var n = count(key, v);
        if (!n) return;
        var b = el("button", "chip", v === "All" ? (key === "region" ? "All regions" : "All topics") : v);
        b.type = "button";
        b.dataset.val = v;
        b.appendChild(el("span", "count", String(n)));
        b.addEventListener("click", function () { state[key] = v; save(); renderStories(); });
        wrap.appendChild(b);
      });
    }
    build("f-region", "region", REGIONS);
    build("f-topic", "topic", topics);

    // Place suggestions for both search boxes.
    var seen = {}, names = [];
    D.stories.concat(D.lighter || []).forEach(function (s) {
      [s.city, s.state, s.country].concat(s.places || []).forEach(function (p) {
        if (p && p !== "Worldwide" && !seen[p]) { seen[p] = 1; names.push(p); }
      });
    });
    names.sort(function (a, b) { return a.localeCompare(b); });
    var dl = $("places");
    names.forEach(function (n) { var o = el("option"); o.value = n; dl.appendChild(o); });

    var q = $("q");
    q.value = state.q;
    q.addEventListener("input", debounce(function () { state.q = q.value.trim(); $("hero-q").value = state.q; renderStories(); }, 140));
    q.addEventListener("keydown", function (e) { if (e.key === "Escape" && q.value) { e.preventDefault(); runSearch("", false); } });
    $("clear-q").addEventListener("click", function () { runSearch("", false); q.focus(); });
    $("hero-search").addEventListener("submit", function (e) { e.preventDefault(); runSearch($("hero-q").value, true); });
    $("open-search").addEventListener("click", function () {
      $("today").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      setTimeout(function () { q.focus({ preventScroll: true }); }, reduceMotion ? 0 : 400);
      closeMenu();
    });
  }

  // ---------------------------------------------------------------- local news, by region
  var LOCAL_ORDER = ["Africa", "Asia-Pacific", "Americas", "Europe", "Middle East", "Global"];
  var REGION_NAME = { "Asia-Pacific": "Asia and the Pacific", Global: "Worldwide" };
  function renderLocal() {
    var wrap = $("local-groups");
    wrap.textContent = "";
    var f = filtering();
    $("local-note").hidden = !f;
    if (f) return;
    var locals = RANKED.filter(function (s) { return s.scale === "local"; });
    LOCAL_ORDER.forEach(function (r) {
      var list = locals.filter(function (s) { return s.region === r; });
      if (!list.length) return;
      // Cluster by country (most stories first), newest first within each.
      var count = {};
      list.forEach(function (s) { count[s.country] = (count[s.country] || 0) + 1; });
      list.sort(function (a, b) {
        return (count[b.country] - count[a.country]) || a.country.localeCompare(b.country) || (latest(b) < latest(a) ? -1 : 1);
      });
      var g = el("section", "local-group rv");
      g.setAttribute("aria-label", "Local news: " + (REGION_NAME[r] || r));
      var head = el("div", "local-head");
      head.appendChild(el("h3", null, REGION_NAME[r] || r));
      var countries = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
      head.appendChild(el("p", "local-places", list.length + (list.length === 1 ? " story from " : " stories from ") + countries.join(", ")));
      g.appendChild(head);
      var ol = el("ol", "more-list");
      list.forEach(function (s) { ol.appendChild(row(s, true)); });
      g.appendChild(ol);
      wrap.appendChild(g);
    });
  }

  // ---------------------------------------------------------------- the week's headlines, searchable by place
  function loadWire() {
    if (!wireLoading) {
      wireLoading = getJSON("data/wire.json")
        .then(function (w) { WIRE = w; return w; })
        .catch(function () { WIRE = { items: [], days: 7, failed: true }; return WIRE; });
    }
    return wireLoading;
  }
  function placeHit(p, q) {
    if (!p) return false;
    var n = norm(p);
    return n === q || n.indexOf(q) === 0 || (q.length > 3 && n.indexOf(q) >= 0);
  }
  function renderWire() {
    var box = $("wire-wrap");
    if (!state.q) { box.hidden = true; return; }
    box.hidden = false;
    var asked = state.q;
    $("wire").textContent = "";
    $("wire-more").hidden = true;
    $("wire-sub").textContent = "Searching this week's headlines…";
    loadWire().then(function () {
      if (state.q !== asked) return;
      var q = norm(asked);
      var hits = WIRE.items.filter(function (i) {
        if (state.region !== "All" && i.r !== state.region) return false;
        i._t = norm(i.t).indexOf(q) >= 0;
        return i._t || placeHit(i.ci, q) || placeHit(i.s, q) || placeHit(i.c, q);
      });
      // Headlines that name the place come before ones that are only from an outlet there.
      hits.sort(function (a, b) { return (b._t - a._t) || b.at.localeCompare(a.at); });
      var sub = $("wire-sub");
      if (WIRE.failed) { sub.textContent = "This week's headlines didn't load. Refresh the page to try again."; return; }
      sub.textContent = hits.length
        ? (hits.length === 1
            ? "1 headline from the past " + WIRE.days + " days mentions “" + asked + "” or comes from an outlet there."
            : hits.length + " headlines from the past " + WIRE.days + " days mention “" + asked + "” or come from outlets there.") +
          " They link to the original reports and haven't been summarized."
        : "No headlines from the past " + WIRE.days + " days mention “" + asked + "”. Try a nearby town, the district or the state, or search further below.";
      wireShown = 30;
      function draw() {
        var ul = $("wire");
        ul.textContent = "";
        hits.slice(0, wireShown).forEach(function (i) { ul.appendChild(wireItem(i.t, i.u, [i.o, [i.ci, i.s, i.c].filter(Boolean).join(", "), ago(i.at)])); });
        var more = $("wire-more");
        more.hidden = hits.length <= wireShown;
        more.onclick = function () { wireShown += 30; draw(); };
      }
      draw();
    });
  }
  function wireItem(title, url, bits) {
    var li = el("li");
    var a = link("", url);
    a.appendChild(document.createTextNode(title));
    a.appendChild(icon("out"));
    li.appendChild(a);
    li.appendChild(el("span", "wire-meta", bits.filter(Boolean).join(" · ")));
    return li;
  }

  // ---------------------------------------------------------------- search further (only when asked)
  var gdelt = { q: null, at: 0 };
  function renderWider() {
    var box = $("wider");
    if (!state.q) { box.hidden = true; return; }
    box.hidden = false;
    $("wider-h").textContent = "Search further for “" + state.q + "”";
    $("gnews").href = "https://news.google.com/search?q=" + encodeURIComponent(state.q);
    if (gdelt.q !== state.q) { $("gdelt").textContent = ""; $("gdelt-status").textContent = ""; }
  }
  function gdeltDate(s) {
    var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
    return m ? m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] + "Z" : null;
  }
  function searchWorldwide() {
    var q = state.q;
    var status = $("gdelt-status"), list = $("gdelt");
    if (!q) return;
    var wait = 6000 - (Date.now() - gdelt.at);
    if (wait > 0) { status.textContent = "The worldwide index allows one search every few seconds. Try again in " + Math.ceil(wait / 1000) + " s."; return; }
    gdelt.at = Date.now();
    gdelt.q = q;
    list.textContent = "";
    status.textContent = "Searching news sites worldwide…";
    var phrase = /\s/.test(q) ? "\"" + q + "\"" : q;
    var url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(phrase) +
      "&mode=artlist&format=json&maxrecords=30&sort=datedesc&timespan=1month";
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 25000);
    fetch(url, { signal: ctl.signal }).then(function (r) { return r.text(); }).then(function (t) {
      clearTimeout(timer);
      if (state.q !== q) return;
      var j = null;
      try { j = JSON.parse(t); } catch (e) {}
      if (!j) {
        status.textContent = /limit requests/i.test(t)
          ? "The worldwide index is busy right now. Wait a minute and try again, or open the search in Google News."
          : "The worldwide index couldn't run that search. Try a different spelling, or open it in Google News.";
        return;
      }
      var arts = j.articles || [];
      status.textContent = arts.length
        ? arts.length + " articles from the past month, newest first. Live from the GDELT Project; not checked or summarized by World Right Now."
        : "The worldwide index found nothing for “" + q + "” in the past month. Google News may have more.";
      arts.forEach(function (a) {
        var at = gdeltDate(a.seendate);
        list.appendChild(wireItem(a.title, a.url, [a.domain, a.sourcecountry, a.language !== "English" ? a.language : "", at ? ago(at) : ""]));
      });
    }).catch(function () {
      clearTimeout(timer);
      if (state.q !== q) return;
      status.textContent = "The worldwide index didn't respond. It may be busy; try again in a minute, or open the search in Google News.";
    });
  }
  $("gdelt-go").addEventListener("click", searchWorldwide);

  // ---------------------------------------------------------------- sources we read
  function renderSources() {
    var box = $("source-list");
    if (!SOURCES) return;
    box.textContent = "";
    var outlets = {};
    SOURCES.feeds.forEach(function (f) { outlets[f.outlet] = 1; });
    $("source-count").textContent = Object.keys(outlets).length;
    LOCAL_ORDER.forEach(function (r) {
      var seen = {}, names = [];
      SOURCES.feeds.filter(function (f) { return f.region === r && f.section !== "sport"; }).forEach(function (f) {
        var label = f.outlet + (f.country && r !== "Global" ? " (" + [f.state, f.country].filter(Boolean).join(", ") + ")" : "");
        if (f.scope === "local" && f.city) label = f.outlet + " (" + f.city + ")";
        if (!seen[label]) { seen[label] = 1; names.push({ label: label, url: new URL(f.url).origin }); }
      });
      if (!names.length) return;
      var p = el("p");
      p.appendChild(el("strong", null, (REGION_NAME[r] || r) + ": "));
      names.forEach(function (n, i) {
        if (i) p.appendChild(document.createTextNode(", "));
        p.appendChild(link(n.label, n.url));
      });
      box.appendChild(p);
    });
  }

  // ---------------------------------------------------------------- map
  var MAP = { svg: null, vb: null, markers: [], s: 1 };
  var ZOOMS = {
    World: [-180, 180, 84, -58],
    Europe: [-25, 45, 71, 33],
    "Middle East": [24, 64, 42, 10],
    Africa: [-20, 54, 38, -36],
    "Asia-Pacific": [62, 180, 56, -48],
    Americas: [-170, -30, 72, -56],
  };
  function mx(lon) { var M = window.WRN_MAP; return (lon + 180) * M.k; }
  function my(lat) { var M = window.WRN_MAP; return (M.top - lat) * M.k; }
  function nightPath() {
    var M = window.WRN_MAP;
    var ss = subsolar(new Date());
    var dec = Math.abs(ss.lat) < 0.2 ? (ss.lat < 0 ? -0.2 : 0.2) : ss.lat;
    var pts = [];
    for (var lon = -180; lon <= 180; lon += 2) {
      var lat = Math.atan(-Math.cos((lon - ss.lon) * RAD) / Math.tan(dec * RAD)) / RAD;
      pts.push(mx(lon).toFixed(1) + "," + Math.max(-20, Math.min(M.h + 20, my(lat))).toFixed(1));
    }
    var edge = dec < 0 ? -20 : M.h + 20; // the pole in darkness
    // Close the shape just outside the map so its outline only draws along the terminator.
    var y0 = pts[0].split(",")[1], y1 = pts[pts.length - 1].split(",")[1];
    return "M-20," + edge + " L-20," + y0 + " L" + pts.join(" L") + " L" + (M.w + 20) + "," + y1 + " L" + (M.w + 20) + "," + edge + " Z";
  }
  function renderMap() {
    var M = window.WRN_MAP;
    var frame = $("map-frame");
    if (!M) { frame.hidden = true; return; }
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + M.w + " " + M.h);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "World map of today's stories");
    MAP.vb = [0, 0, M.w, M.h];

    var grat = document.createElementNS(NS, "path");
    var d = "";
    for (var lo = -150; lo <= 150; lo += 30) d += "M" + mx(lo) + ",0V" + M.h;
    for (var la = -30; la <= 60; la += 30) d += "M0," + my(la) + "H" + M.w;
    grat.setAttribute("d", d);
    grat.setAttribute("class", "grat");
    grat.setAttribute("aria-hidden", "true");
    svg.appendChild(grat);

    var land = document.createElementNS(NS, "path");
    land.setAttribute("class", "land");
    land.setAttribute("d", M.land);
    land.setAttribute("aria-hidden", "true");
    svg.appendChild(land);

    var shade = document.createElementNS(NS, "path");
    shade.setAttribute("class", "nightshade");
    shade.setAttribute("d", nightPath());
    shade.setAttribute("aria-hidden", "true");
    svg.appendChild(shade);
    MAP.shade = shade;

    var tip = $("map-tip");
    var seen = {}, unplaced = [];
    var topIds = RANKED.slice(0, 3).map(function (s) { return s.id; });
    // Draw ordinary markers first so the top stories sit on top.
    RANKED.slice().reverse().forEach(function (s) {
      if (s.lat == null || s.lon == null) { if (unplaced.indexOf(s.city) < 0) unplaced.push(s.city); return; }
      var key = s.lat + "," + s.lon;
      var n = seen[key] = (seen[key] || 0) + 1;
      var top = topIds.indexOf(s.id) >= 0;
      var a = document.createElementNS(NS, "a");
      a.setAttribute("href", "#s-" + s.id);
      a.setAttribute("class", "mk" + (top ? " top" : s.scale === "local" ? " loc" : ""));
      a.setAttribute("aria-label", s.city + ": " + s.title);
      var halo = document.createElementNS(NS, "circle");
      halo.setAttribute("class", "halo");
      var core = document.createElementNS(NS, "circle");
      core.setAttribute("class", "core");
      a.appendChild(halo);
      a.appendChild(core);
      var m = { a: a, halo: halo, core: core, x: mx(s.lon), y: my(s.lat), n: n - 1, top: top };
      MAP.markers.push(m);
      function show() {
        var fr = frame.getBoundingClientRect(), cr = core.getBoundingClientRect();
        tip.textContent = "";
        tip.appendChild(el("b", null, s.city + " · " + shortTime(s.tz)));
        tip.appendChild(document.createTextNode(s.title));
        tip.style.left = Math.min(Math.max(150, cr.left + cr.width / 2 - fr.left), fr.width - 150) + "px";
        tip.style.top = (cr.top - fr.top) + "px";
        tip.hidden = false;
      }
      a.addEventListener("mouseenter", show);
      a.addEventListener("focus", show);
      a.addEventListener("mouseleave", function () { tip.hidden = true; });
      a.addEventListener("blur", function () { tip.hidden = true; });
      a.addEventListener("click", function (e) { e.preventDefault(); tip.hidden = true; showStory(s.id); });
      svg.appendChild(a);
    });
    // Bring the top markers to the front.
    MAP.markers.filter(function (m) { return m.top; }).forEach(function (m) { svg.appendChild(m.a); });
    frame.appendChild(svg);
    MAP.svg = svg;
    sizeMarkers();

    // Click anywhere on the map to zoom in there and list the stories around it.
    svg.addEventListener("click", function (e) {
      if (e.target.closest(".mk")) return;
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var p = pt.matrixTransform(svg.getScreenCTM().inverse());
      var lon = p.x / M.k - 180, lat = M.top - p.y / M.k;
      var half = Math.max(8, MAP.vb[2] / M.k / 8); // each click zooms in further, down to about 16°
      zoomToBox([lon - half, lon + half, lat + half * 0.66, lat - half * 0.66]);
      Array.prototype.forEach.call($("map-zoom").children, function (c) { c.setAttribute("aria-pressed", "false"); });
      showNearby(lat, lon, "nearby-map");
    });

    var placed = MAP.markers.length;
    $("map-note").textContent = placed + " of " + D.stories.length + " stories on the map." +
      (unplaced.length ? " Not shown, because they have no single location: " + unplaced.join(", ") + "." : "");
    $("night-label").textContent = "Night as of " + utcNow() + " UTC";

    var zoomWrap = $("map-zoom");
    Object.keys(ZOOMS).forEach(function (name) {
      var b = el("button", "chip", name);
      b.type = "button";
      b.dataset.val = name;
      b.setAttribute("aria-pressed", String(name === "World"));
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(zoomWrap.children, function (c) { c.setAttribute("aria-pressed", String(c === b)); });
        $("nearby-map").hidden = true;
        zoomTo(name);
      });
      zoomWrap.appendChild(b);
    });

    $("night-toggle").addEventListener("change", function () {
      frame.classList.toggle("no-night", !this.checked);
    });
  }
  function sizeMarkers() {
    var s = MAP.vb[2] / window.WRN_MAP.w;
    var frameW = $("map-frame").clientWidth || 1000;
    var px = MAP.vb[2] / frameW; // viewBox units per screen pixel
    // Smaller markers on small maps so nearby stories stay apart; slightly larger when zoomed in.
    var size = Math.max(0.55, Math.min(1, frameW / 900)) * Math.max(1, 0.9 / Math.sqrt(s));
    MAP.markers.forEach(function (m) {
      var x = m.x + m.n * 13 * px * size;
      m.core.setAttribute("cx", x); m.core.setAttribute("cy", m.y);
      m.halo.setAttribute("cx", x); m.halo.setAttribute("cy", m.y);
      m.core.setAttribute("r", (m.top ? 6 : 4.5) * px * size);
      m.halo.setAttribute("r", (m.top ? 15 : 10) * px * size);
    });
  }
  function zoomTo(name) { zoomToBox(ZOOMS[name]); }
  function zoomToBox(z) {
    var M = window.WRN_MAP;
    var x0 = mx(z[0]), x1 = mx(z[1]), y0 = Math.max(0, my(z[2])), y1 = Math.min(M.h, my(z[3]));
    // Keep the frame's aspect ratio: grow the box in one direction to fit.
    var aspect = M.w / M.h;
    var w = x1 - x0, h = y1 - y0;
    if (w / h > aspect) { var nh = w / aspect; y0 -= (nh - h) / 2; h = nh; } else { var nw = h * aspect; x0 -= (nw - w) / 2; w = nw; }
    x0 = Math.max(0, Math.min(M.w - w, x0)); y0 = Math.max(0, Math.min(M.h - h, y0));
    var to = [x0, y0, Math.min(w, M.w), Math.min(h, M.h)];
    var from = MAP.vb.slice();
    var t0 = performance.now(), dur = reduceMotion ? 0 : 650;
    function step(now) {
      var t = dur ? Math.min(1, (now - t0) / dur) : 1;
      var e = 1 - Math.pow(1 - t, 3);
      MAP.vb = from.map(function (v, i) { return v + (to[i] - v) * e; });
      MAP.svg.setAttribute("viewBox", MAP.vb.map(function (v) { return v.toFixed(2); }).join(" "));
      sizeMarkers();
      if (t < 1) frame(step);
    }
    frame(step);
  }

  // ---------------------------------------------------------------- timelines
  var threadIds = [];
  function renderThreads() {
    var tabs = $("thread-tabs"), panels = $("thread-panels");
    threadIds = Object.keys(THREADS);
    var top = RANKED.find(function (s) { return s.thread && THREADS[s.thread]; });
    var first = top ? top.thread : threadIds[0];
    threadIds.forEach(function (id) {
      var t = THREADS[id];
      var tab = el("button", "tab", t.title);
      tab.type = "button";
      tab.id = "tab-" + id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "thread-" + id);
      tab.addEventListener("click", function () { selectThread(id, false); });
      tab.addEventListener("keydown", tabKeys);
      tabs.appendChild(tab);

      var p = el("article", "thread");
      p.id = "thread-" + id;
      p.setAttribute("role", "tabpanel");
      p.setAttribute("aria-labelledby", "tab-" + id);
      p.tabIndex = 0;
      var fig = el("figure", "thread-fig");
      if (t.image) {
        var img = el("img");
        img.src = t.image.src; img.alt = t.image.alt || ""; img.loading = "lazy"; img.decoding = "async";
        img.width = 1200; img.height = 900;
        fig.appendChild(img);
        if (t.image.credit) {
          var cap = el("figcaption");
          cap.appendChild(document.createTextNode("Photo: "));
          cap.appendChild(link(t.image.credit, t.image.url || "#"));
          fig.appendChild(cap);
        }
      } else {
        fig.classList.add("inset-none");
        fig.appendChild(icon("layers"));
      }
      p.appendChild(fig);
      var body = el("div", "thread-body");
      body.appendChild(el("h3", null, t.title));
      body.appendChild(rich(t.intro, "p", "thread-intro"));
      var ol = el("ol", "tl");
      t.events.forEach(function (ev) {
        var li = el("li");
        var tm = el("time", "num", fmtEventDate(ev.date));
        tm.setAttribute("datetime", ev.date);
        li.appendChild(tm);
        li.appendChild(rich(ev.text));
        if (ev.source) {
          var src = el("p", "src");
          src.appendChild(outLink(ev.source.outlet, ev.source.url));
          li.appendChild(src);
        }
        ol.appendChild(li);
      });
      body.appendChild(ol);
      var today = RANKED.filter(function (s) { return s.thread === id; });
      if (today.length) {
        var tl = el("div", "today-links");
        tl.appendChild(el("p", null, "In today's edition"));
        today.forEach(function (s) {
          var a = link("", "#s-" + s.id);
          a.appendChild(icon("arrow"));
          a.appendChild(document.createTextNode(s.title));
          a.addEventListener("click", function (e) { e.preventDefault(); showStory(s.id); });
          tl.appendChild(a);
        });
        body.appendChild(tl);
      }
      p.appendChild(body);
      panels.appendChild(p);
    });
    selectThread(first, false, true);
  }
  function selectThread(id, scroll, quiet) {
    if (!THREADS[id]) return;
    threadIds.forEach(function (t) {
      var on = t === id;
      var tab = $("tab-" + t);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $("thread-" + t).hidden = !on;
    });
    if (!quiet) $("tab-" + id).scrollIntoView({ block: "nearest", inline: "nearest" });
    if (scroll) $("ongoing").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }
  function tabKeys(e) {
    var i = threadIds.indexOf(this.id.slice(4));
    var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? threadIds.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    j = (j + threadIds.length) % threadIds.length;
    selectThread(threadIds[j], false);
    $("tab-" + threadIds[j]).focus();
  }

  // ---------------------------------------------------------------- key terms
  function renderTerms() {
    var grid = $("terms");
    Object.keys(TERMS)
      .sort(function (a, b) { return TERMS[a].term.localeCompare(TERMS[b].term); })
      .forEach(function (id) {
        var d = el("div", "rv");
        d.id = "term-" + id;
        d.dataset.text = norm(TERMS[id].term + " " + TERMS[id].definition);
        d.appendChild(el("dt", null, TERMS[id].term));
        d.appendChild(el("dd", null, TERMS[id].definition));
        grid.appendChild(d);
      });
    var input = $("term-q");
    input.addEventListener("input", function () { filterTerms(input.value); });
  }
  function filterTerms(v) {
    var q = norm(v), shown = 0;
    Array.prototype.forEach.call($("terms").children, function (d) {
      var on = !q || d.dataset.text.indexOf(q) >= 0;
      d.hidden = !on;
      if (on) { shown++; d.classList.add("is-in"); }
    });
    $("terms-empty").hidden = shown > 0;
  }
  function showTerm(id) {
    var node = $(id);
    if (!node) return;
    if (node.hidden) { $("term-q").value = ""; filterTerms(""); }
    node.classList.add("is-in", "flash");
    setTimeout(function () { node.classList.remove("flash"); }, 2400);
    node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }

  // ---------------------------------------------------------------- lighter and sport
  function renderLighter() {
    var row = $("light");
    (D.lighter || []).forEach(function (s) {
      var a = el("article", "light-card rv");
      a.appendChild(inset(s, 30));
      var b = el("div", "light-body");
      b.appendChild(dateline(s, { short: true }));
      b.appendChild(el("h3", null, s.title));
      b.appendChild(rich(s.summary, "p", "sum"));
      s.sources.forEach(function (x) { b.appendChild(outLink(x.outlet, x.url, "out")); });
      a.appendChild(b);
      row.appendChild(a);
    });
    frame(function () { insets.forEach(paintInset); });
  }
  function renderSport() {
    var ul = $("sport");
    (D.sport || []).forEach(function (x) {
      var li = el("li", "score rv");
      li.appendChild(el("p", "r", x.result));
      li.appendChild(el("p", "n", x.note));
      li.appendChild(outLink(x.outlet, x.url, "out"));
      ul.appendChild(li);
    });
  }
  function renderCredits() {
    var parts = [];
    Object.keys(THREADS).forEach(function (id) {
      var im = THREADS[id].image;
      if (im && im.credit) parts.push({ t: THREADS[id].title, c: im.credit, u: im.url });
    });
    var p = $("photo-credits");
    if (!parts.length) return;
    p.appendChild(document.createTextNode("Timeline photos: "));
    parts.forEach(function (x, i) {
      if (i) p.appendChild(document.createTextNode("; "));
      p.appendChild(document.createTextNode(x.t + ", "));
      p.appendChild(link(x.c, x.u));
    });
    p.appendChild(document.createTextNode(", via Wikimedia Commons."));
  }

  // ---------------------------------------------------------------- reveal on scroll
  var io = ("IntersectionObserver" in window) && !reduceMotion
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px" })
    : null;
  function reveal() {
    Array.prototype.forEach.call(document.querySelectorAll(".rv:not(.is-in)"), function (n, i) {
      if (!io) { n.classList.add("is-in"); return; }
      n.style.transitionDelay = (n.classList.contains("feature") ? (Array.prototype.indexOf.call(n.parentNode.children, n) * 80) : 0) + "ms";
      io.observe(n);
    });
  }

  // ---------------------------------------------------------------- page chrome
  var menuBtn = $("menu-btn"), nav = $("nav");
  function closeMenu() { nav.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
  menuBtn.addEventListener("click", function () {
    var open = !nav.classList.contains("open");
    nav.classList.toggle("open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) nav.querySelector("a").focus();
  });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (popFor) { closePop(true); return; }
    if (nav.classList.contains("open")) { closeMenu(); menuBtn.focus(); }
  });

  // Links to a timeline (from stories) open the right tab.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#thread-"]');
    if (!a) return;
    e.preventDefault();
    selectThread(a.getAttribute("href").slice(8), true);
  });

  $("clear").addEventListener("click", function () {
    try { localStorage.removeItem("wrn-filters"); } catch (e) {}
    state.region = "All"; state.topic = "All";
    if (D) renderStories();
    $("cleared").textContent = "Done. This site has nothing saved in your browser now.";
  });

  function tick() {
    Array.prototype.forEach.call(document.querySelectorAll(".local[data-tz]"), function (n) { n.textContent = localTime(n.dataset.tz); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-short]"), function (n) { n.textContent = shortTime(n.dataset.short) + " there"; });
  }
  function hourly() {
    // Light and shade move slowly; refresh them every few minutes.
    if (earth.day) { buildComposite(); drawEarth(); $("earth-cap").textContent = $("earth-cap").textContent.replace(/at \d\d:\d\d UTC/, "at " + utcNow() + " UTC"); }
    if (MAP.shade) { MAP.shade.setAttribute("d", nightPath()); $("night-label").textContent = "Night as of " + utcNow() + " UTC"; }
    insets.forEach(paintInset);
  }
  var onResize = debounce(function () {
    drawEarth();
    if (MAP.svg) sizeMarkers();
    insets.forEach(paintInset);
  }, 150);

  function getJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }

  Promise.all([
    getJSON("data/latest.json"), getJSON("data/terms.json"), getJSON("data/threads.json"),
    getJSON("data/sources.json").catch(function () { return null; }),
  ])
    .then(function (res) {
      D = res[0]; TERMS = res[1]; THREADS = res[2]; SOURCES = res[3];
      renderSources();
      RANKED = D.stories.slice().sort(function (a, b) { return score(b) - score(a); });
      renderHero();
      startEarth();
      buildControls();
      renderStories();
      renderMap();
      renderThreads();
      renderTerms();
      renderLighter();
      renderSport();
      renderCredits();
      reveal();
      setInterval(tick, 30000);
      setInterval(hourly, 5 * 60000);
      window.addEventListener("resize", onResize);
      // Deep links to a story, timeline or term, on load and when the hash changes.
      function followHash(onLoad) {
        var h = location.hash.slice(1);
        if (/^s-/.test(h)) showStory(h.slice(2));
        else if (/^thread-/.test(h)) selectThread(h.slice(7), true);
        else if (/^term-/.test(h)) showTerm(h);
        else if (onLoad && h && $(h)) $(h).scrollIntoView();
      }
      followHash(true);
      window.addEventListener("hashchange", function () { followHash(false); });
    })
    .catch(function () {
      var st = $("stale");
      st.hidden = false;
      st.textContent = "Today's stories didn't load. Refresh the page to try again.";
    });
})();
