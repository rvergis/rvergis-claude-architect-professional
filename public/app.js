/* CCAR-P practice exam generator. Static, no build step. */
(function () {
  "use strict";

  var LETTERS = "ABCDE";
  var YESNO = ["Yes", "No"];
  var STORE_KEY = "ccarp.v1";
  var FORMS = 100;
  var app = document.getElementById("app");
  var timerEl = document.getElementById("timer");
  var countEl = document.getElementById("qcount");
  var BANK = null;
  var state = { view: "home", exam: null };
  var tick = null;

  /* ---------- storage (best effort) ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }
  function saveProgress() {
    var d = load(); d.inProgress = state.exam && !state.exam.submitted ? state.exam : null; save(d);
    scheduleSync();
  }

  /* ---------- exam versions ---------- */
  /* The bank carries one blueprint per exam-guide version. Questions list the versions they fit
     (no list means every version). Before a version's effective date the previous one is the default. */
  function versionIds() { return Object.keys(BANK.versions).sort(); }
  function blueprint(ver) { return BANK.versions[ver] || BANK.versions[defaultVersion()]; }
  function defaultVersion() {
    var ids = versionIds(), today = new Date().toISOString().slice(0, 10), pick = ids[0];
    ids.forEach(function (v) { if (!BANK.versions[v].effective_from || BANK.versions[v].effective_from <= today) pick = v; });
    return pick;
  }
  function chosenVersion() {
    var p = load().prefs || {};
    return p.version && BANK.versions[p.version] ? p.version : defaultVersion();
  }
  function fits(q, ver) { return !q.versions || q.versions.indexOf(ver) >= 0; }
  function pool(ver, domain) {
    return BANK.questions.filter(function (q) { return fits(q, ver) && (domain === undefined || q.domain === domain); });
  }

  /* ---------- resume codes (cross-device) ---------- */
  /* The server keeps a compact copy of the exam under a 4-letter code: question IDs, option order,
     answers and the clock. The full exam is rebuilt from the question bank on the other device. */
  var API = "api/progress";
  var syncTimer = null;
  function compact(ex) {
    var byId = bankById();
    return {
      v: 1, ver: ex.ver, title: ex.title, mode: ex.mode, form: ex.form, study: ex.study, minutes: ex.minutes, timed: !!ex.timed,
      elapsedBefore: elapsed(ex), current: ex.current, savedAt: Date.now(),
      items: ex.items.map(function (it) {
        var q = byId[it.id], src = q ? baseOptions(q) : [];
        return { id: it.id, o: it.options.map(function (t) { return src.indexOf(t); }), c: it.chosen, f: it.flagged ? 1 : 0, k: it.checked ? 1 : 0, u: it.unscored ? 1 : 0 };
      })
    };
  }
  function expand(st, code) {
    var byId = bankById();
    var items = st.items.filter(function (x) { return byId[x.id]; }).map(function (x) {
      var q = byId[x.id], n = baseOptions(q).length;
      var perm = x.o && x.o.length === n && x.o.every(function (i) { return i >= 0 && i < n; }) ? x.o : Array.from({ length: n }, function (_, i) { return i; });
      var it = itemFromPerm(q, perm);
      var c = x.c || [];
      if (it.type === "choice") it.chosen = c.filter(function (i) { return i >= 0 && i < n; });
      else it.chosen = it.rows.map(function (_, r) { var v = c[r]; return typeof v === "number" && v >= 0 && v < rowChoices(it).length ? v : -1; });
      it.flagged = !!x.f; it.checked = !!x.k; it.unscored = !!x.u;
      return it;
    });
    return {
      ver: st.ver && BANK.versions[st.ver] ? st.ver : versionIds()[0],
      title: st.title, mode: st.mode, form: st.form, study: !!st.study, minutes: st.minutes || 0, timed: !!st.timed,
      startedAt: null, elapsedBefore: st.elapsedBefore || 0, items: items,
      current: Math.min(st.current || 0, items.length - 1), submitted: false, code: code
    };
  }
  var _byId = null;
  function bankById() { if (!_byId) { _byId = {}; BANK.questions.forEach(function (q) { _byId[q.id] = q; }); } return _byId; }
  function scheduleSync() {
    var ex = state.exam;
    if (!ex || ex.submitted || !ex.code) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(); }, 1500);
  }
  function syncNow() {
    var ex = state.exam;
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    if (!ex || ex.submitted || !ex.code) return;
    try {
      fetch(API + "/" + ex.code, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(compact(ex)) }).catch(function () {});
    } catch (e) { /* offline: the local copy is still saved */ }
  }
  function requestCode(ex) {
    if (!window.fetch || ex.mode === "drill") return;
    fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compact(ex)) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !res.code || state.exam !== ex || ex.submitted) return;
        ex.code = res.code; saveProgress();
        if (state.view === "exam") renderExam();
      }).catch(function () { /* no code; the exam still works on this device */ });
  }
  function forgetCode(code) {
    if (!code) return;
    try { fetch(API + "/" + code, { method: "DELETE", keepalive: true }).catch(function () {}); } catch (e) {}
  }
  function loadByCode(code, done) {
    code = String(code || "").trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { done("Enter the 4-letter code shown at the top of your exam."); return; }
    fetch(API + "/" + code, { cache: "no-store" })
      .then(function (r) { if (r.status === 404) throw new Error("nf"); if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function (st) {
        var ex = expand(st, code);
        if (!ex.items.length) { done("That exam couldn't be loaded."); return; }
        state.exam = ex; resumeClock(ex); saveProgress(); renderExam(); startTimer(); done(null);
      })
      .catch(function (e) { done(e.message === "nf" ? "No exam found for " + code + ". Codes expire 30 days after the last save." : "Couldn't reach the server. Check your connection and try again."); });
  }
  function addHistory(entry) {
    var d = load(); d.history = d.history || []; d.history.unshift(entry); d.history = d.history.slice(0, 200);
    d.inProgress = null; save(d);
  }

  /* ---------- seeded randomness ---------- */
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(arr, r) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function domainName(id) { for (var i = 0; i < BANK.domains.length; i++) if (BANK.domains[i].id === id) return BANK.domains[i].name; return "Domain " + id; }
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); }
  function remapLetters(text, oldToNew) {
    return text.replace(/\(([A-E](?:\s*,\s*[A-E])*)\)/g, function (_, grp) {
      var letters = grp.match(/[A-E]/g).map(function (c) { var n = oldToNew[LETTERS.indexOf(c)]; return n === undefined ? c : LETTERS[n]; });
      letters.sort(); return "(" + letters.join(", ") + ")";
    });
  }
  function qType(q) { return q.type || "choice"; }
  /* The list that gets shuffled: answer options, or the lettered choices of a matching item. */
  function baseOptions(q) { var t = qType(q); return t === "choice" ? q.options : t === "match" ? q.choices : []; }
  function rowChoices(it) { return it.type === "yesno" ? YESNO : it.options; }
  function isGrid(it) { return it.type !== "choice"; }
  function isAnswered(it) {
    return isGrid(it) ? it.chosen.length === it.rows.length && it.chosen.every(function (c) { return c >= 0; }) : it.chosen.length === it.select;
  }
  function answerText(it) {
    if (it.type === "yesno") return it.answer.map(function (a, r) { return (r + 1) + ": " + YESNO[a]; }).join(" · ");
    if (it.type === "match") return it.answer.map(function (a, r) { return (r + 1) + ": " + LETTERS[a]; }).join(" · ");
    return it.answer.map(function (a) { return LETTERS[a]; }).join(", ");
  }
  function instruction(it) {
    if (it.type === "yesno") return "For each statement, select Yes or No.";
    if (it.type === "match") return "Match each item to the best choice. A choice may be used once, more than once, or not at all.";
    return it.select > 1 ? "Choose " + ["", "", "TWO", "THREE"][it.select] + "." : "Choose ONE.";
  }

  /* ---------- exam construction ---------- */
  function buildItem(q, r) {
    var n = baseOptions(q).length, perm = shuffle(Array.from({ length: n }, function (_, i) { return i; }), r);
    return itemFromPerm(q, perm);
  }
  function itemFromPerm(q, perm) {
    var type = qType(q), oldToNew = {};
    perm.forEach(function (oldIdx, newIdx) { oldToNew[oldIdx] = newIdx; });
    var it = {
      id: q.id, domain: q.domain, type: type, select: q.select || 1, stem: q.stem,
      options: perm.map(function (i) { return baseOptions(q)[i]; }),
      explanation: remapLetters(q.explanation, oldToNew),
      flagged: false, checked: false, unscored: false
    };
    if (type === "choice") {
      it.answer = q.answer.map(function (a) { return oldToNew[a]; }).sort();
      it.chosen = [];
    } else {
      it.rows = type === "yesno" ? q.statements.slice() : q.rows.slice();
      it.answer = type === "yesno" ? q.answer.map(function (b) { return b ? 0 : 1; }) : q.answer.map(function (a) { return oldToNew[a]; });
      it.chosen = it.rows.map(function () { return -1; });
    }
    return it;
  }

  function buildExam(opts) {
    var ver = opts.ver || chosenVersion(), bp = blueprint(ver);
    /* v1.0 forms keep their original seeds; later versions get their own. */
    var vtag = ver === versionIds()[0] ? "" : ver + "-";
    var seedLabel = opts.mode === "form" ? "form-" + vtag + opts.form : opts.mode === "drill" ? "drill-" + opts.domain + "-" + Date.now() : "random-" + Date.now();
    var r = rng(hashStr(seedLabel));
    var picked = [];
    if (opts.mode === "drill") {
      picked = shuffle(pool(ver, opts.domain), r).slice(0, Math.max(1, opts.count));
    } else {
      bp.domains.forEach(function (d) { picked = picked.concat(shuffle(pool(ver, d.id), r).slice(0, d.items)); });
      picked = shuffle(picked, r);
    }
    var items = picked.map(function (q) { return buildItem(q, r); });
    /* Like the real exam, some items are trial items that don't count. You aren't told which until the end. */
    if (opts.mode !== "drill" && bp.unscored) {
      shuffle(items.map(function (_, i) { return i; }), r).slice(0, bp.unscored).forEach(function (i) { items[i].unscored = true; });
    }
    var title = (opts.mode === "form" ? "Practice Form " + opts.form : opts.mode === "drill" ? "Drill · " + domainName(opts.domain) : "Random Form") + " · v" + ver;
    return {
      ver: ver, title: title, mode: opts.mode, form: opts.form || null, study: !!opts.study,
      minutes: opts.minutes, timed: !!opts.timed && !!opts.minutes,
      startedAt: opts.timed && opts.minutes ? Date.now() : null, elapsedBefore: 0,
      items: items, current: 0, submitted: false
    };
  }

  function isCorrect(it) {
    if (it.chosen.length !== it.answer.length) return false;
    var a = it.chosen.slice(), b = it.answer.slice();
    if (!isGrid(it)) { a.sort(); b.sort(); }
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function scored(ex) { return ex.items.filter(function (it) { return !it.unscored; }); }

  /* ---------- timer ---------- */
  function elapsed(ex) { return ex.elapsedBefore + (ex.startedAt ? (Date.now() - ex.startedAt) / 1000 : 0); }
  function pauseClock(ex) { if (ex && ex.startedAt) { ex.elapsedBefore = elapsed(ex); ex.startedAt = null; } }
  function resumeClock(ex) { if (ex && ex.timed && !ex.startedAt) ex.startedAt = Date.now(); }
  /* Exams saved by older versions of the app. */
  function upgrade(ex) {
    if (ex.timed === undefined) { ex.timed = !!ex.minutes; if (!ex.minutes && ex.mode !== "drill") ex.minutes = BANK.minutes; }
    if (!ex.ver || !BANK.versions[ex.ver]) ex.ver = versionIds()[0];
    ex.items.forEach(function (it) { if (!it.type) it.type = "choice"; });
    return ex;
  }
  function setTimed(ex, on) {
    if (on) { ex.timed = true; resumeClock(ex); startTimer(); }
    else { pauseClock(ex); ex.timed = false; stopTimer(); timerEl.hidden = true; }
    saveProgress(); renderExam();
  }
  /* A timed exam keeps running in a background tab, as the real exam does. Save & exit still pauses it. */
  document.addEventListener("visibilitychange", function () {
    var ex = state.exam;
    if (state.view !== "exam" || !ex || ex.submitted) return;
    if (document.hidden) { saveProgress(); syncNow(); }
  });
  function startTimer() {
    stopTimer();
    var ex = state.exam;
    if (!ex || !ex.minutes || !ex.timed) { timerEl.hidden = true; return; }
    timerEl.hidden = false;
    var update = function () {
      var left = ex.minutes * 60 - elapsed(ex);
      timerEl.innerHTML = '<span class="tlabel">Time remaining</span> ' + fmtTime(left);
      timerEl.classList.toggle("low", left < 600);
      if (left <= 0) { stopTimer(); submit(true); }
    };
    update(); tick = setInterval(update, 1000);
  }
  function stopTimer() { if (tick) clearInterval(tick); tick = null; }
  function hideTopbarExtras() { stopTimer(); timerEl.hidden = true; countEl.hidden = true; }

  /* ---------- views ---------- */
  function renderHome() {
    hideTopbarExtras(); state.view = "home";
    var d = load(), hist = d.history || [], done = {};
    var prefs = d.prefs || { timed: true, study: false };
    var ver = chosenVersion(), bp = blueprint(ver), vpool = pool(ver);
    hist.forEach(function (h) { if (h.form && (h.ver || versionIds()[0]) === ver) done[h.form] = true; });
    var counts = {}; vpool.forEach(function (q) { counts[q.domain] = (counts[q.domain] || 0) + 1; });
    var multi = vpool.filter(function (q) { return (q.select || 1) > 1; }).length;
    var grids = vpool.filter(function (q) { return qType(q) !== "choice"; }).length;

    var html = '<h1>Claude Certified Architect – Professional<br><span class="muted">Hard practice exams</span></h1>' +
      '<p class="muted">Each exam follows the official CCAR-P domain weighting for the exam-guide version you pick, with scenario-based single-answer, multiple-response, Yes/No and matching items, timed at ' + bp.minutes + ' minutes. Questions are written to be harder than the real exam.</p>';

    html += '<div class="card"><div class="row"><div><h3>Exam version</h3><div class="muted small">' + esc(bp.note) + '</div></div><div class="spacer"></div>' +
      '<select id="examVersion" aria-label="Exam guide version">' + versionIds().map(function (v) {
        return '<option value="' + v + '"' + (v === ver ? ' selected' : '') + '>' + esc(BANK.versions[v].label) + '</option>';
      }).join("") + '</select></div></div>';

    html += '<div class="card"><div class="row"><div><h3>Continue on this device</h3><div class="muted small">Type the 4-letter code shown at the top of an exam you started elsewhere.</div></div><div class="spacer"></div>' +
      '<input type="text" id="resumeCode" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" style="width:6.5em;text-transform:uppercase;letter-spacing:.15em;text-align:center">' +
      '<button class="btn primary" id="loadCode">Continue</button></div><div class="muted small" id="codeMsg" role="status"></div></div>';

    if (d.inProgress) {
      upgrade(d.inProgress);
      html += '<div class="card"><div class="row"><div><h3>Resume: ' + esc(d.inProgress.title) + '</h3><div class="muted small">' +
        d.inProgress.items.filter(isAnswered).length + ' of ' + d.inProgress.items.length + ' answered</div></div><div class="spacer"></div>' +
        '<button class="btn primary" id="resume">Resume</button><button class="btn" id="discard">Discard</button></div></div>';
    }

    html += '<div class="grid2"><div class="card"><h3>Start an exam</h3>' +
      '<p class="muted small">' + bp.items_per_exam + ' questions' + (bp.unscored ? ' (' + (bp.items_per_exam - bp.unscored) + ' scored, ' + bp.unscored + ' unscored trial items you won\'t know about until the end)' : '') + '.</p>' +
      '<label class="check"><input type="checkbox" id="timed"' + (prefs.timed ? ' checked' : '') + '> Time limit: ' + bp.minutes + ' minutes <span class="muted small">(you can also switch it on or off during the exam)</span></label>' +
      '<label class="check"><input type="checkbox" id="study"' + (prefs.study ? ' checked' : '') + '> Study mode <span class="muted small">(show the answer after each question)</span></label>' +
      '<label class="field" for="formNo">Practice form (1–' + FORMS + ')</label>' +
      '<div class="row"><input type="number" id="formNo" min="1" max="' + FORMS + '" value="' + nextForm(done) + '"><button class="btn primary" id="startForm">Start form</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" id="startRandom">Random form</button></div>' +
      '<p class="muted small" style="margin-top:10px">These settings also apply to the numbered forms below.</p></div>' +
      '<div class="card"><h3>Domain drill</h3>' +
      '<label class="field" for="drillDomain">Domain</label><select id="drillDomain">' +
      BANK.domains.map(function (dm) { return '<option value="' + dm.id + '">' + dm.id + '. ' + esc(dm.name) + ' (' + (counts[dm.id] || 0) + ')</option>'; }).join("") +
      '</select><label class="field" for="drillCount">Questions</label><div class="row"><input type="number" id="drillCount" min="1" max="60" value="10">' +
      '<button class="btn" id="startDrill">Start drill</button></div><p class="muted small" style="margin-top:10px">Drills run in study mode with no timer.</p></div></div>';

    html += '<div class="card"><h3>Practice forms · v' + esc(ver) + '</h3><p class="muted small">Forms are fixed: the same number always produces the same questions and option order, so you can retake one. Green forms have been completed.</p><div class="formgrid">';
    for (var f = 1; f <= FORMS; f++) html += '<button data-form="' + f + '" class="' + (done[f] ? "done" : "") + '">' + f + '</button>';
    html += '</div></div>';

    html += '<h2>Blueprint · ' + esc(bp.label) + '</h2><div class="card"><table><thead><tr><th>Domain</th><th class="num">Weight</th><th class="num">Items / exam</th><th class="num">In bank</th></tr></thead><tbody>' +
      bp.domains.map(function (dm) { return '<tr><td>' + dm.id + '. ' + esc(domainName(dm.id)) + '</td><td class="num">' + dm.weight + '%</td><td class="num">' + dm.items + '</td><td class="num">' + (counts[dm.id] || 0) + '</td></tr>'; }).join("") +
      '<tr><td><strong>Total</strong></td><td class="num">100%</td><td class="num">' + bp.items_per_exam + '</td><td class="num">' + vpool.length + '</td></tr></tbody></table>' +
      '<p class="muted small" style="margin-top:10px">Bank v' + esc(BANK.version) + ': ' + vpool.length + ' questions for this version (' + multi + ' multiple-response, ' + grids + ' Yes/No or matching). Forms share questions; option order is reshuffled per form.</p></div>';

    if (hist.length) {
      html += '<h2>History</h2><div class="card"><table><thead><tr><th>Exam</th><th>Date</th><th class="num">Score</th><th class="num">Time</th></tr></thead><tbody>' +
        hist.slice(0, 15).map(function (h) { return '<tr><td>' + esc(h.title) + '</td><td>' + new Date(h.date).toLocaleString() + '</td><td class="num">' + h.correct + '/' + h.total + ' (' + h.pct + '%)</td><td class="num">' + fmtTime(h.seconds) + '</td></tr>'; }).join("") +
        '</tbody></table></div>';
    }

    html += '<div class="note">Scoring: an item counts as correct only when every part is right: exactly the right option(s), or every row of a Yes/No or matching item. Unscored trial items are left out of the score. The real exam reports a scaled score (passing is 720 on a 100–1,000 scale); the percentages here are raw and are not converted to that scale.</div>';
    app.innerHTML = html;

    var vs = document.getElementById("examVersion");
    if (vs) vs.addEventListener("change", function () { var dd = load(); dd.prefs = dd.prefs || { timed: true, study: false }; dd.prefs.version = vs.value; save(dd); renderHome(); });
    ["timed", "study"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", function () { var dd = load(); dd.prefs = dd.prefs || { timed: true, study: false }; dd.prefs[id] = el.checked; save(dd); });
    });
    bind("startForm", function () { var n = parseInt(val("formNo"), 10); if (n >= 1 && n <= FORMS) start({ mode: "form", form: n }); });
    bind("startRandom", function () { start({ mode: "random" }); });
    bind("startDrill", function () { start({ mode: "drill", domain: parseInt(val("drillDomain"), 10), count: Math.max(1, parseInt(val("drillCount"), 10) || 10), study: true, untimed: true }); });
    bind("resume", function () { var ip = upgrade(load().inProgress); ip.startedAt = null; resumeClock(ip); state.exam = ip; renderExam(); startTimer(); });
    bind("discard", function () { var dd = load(); if (dd.inProgress) forgetCode(dd.inProgress.code); dd.inProgress = null; save(dd); renderHome(); });
    var codeLoad = function () {
      var cur = load().inProgress, typed = val("resumeCode").trim().toUpperCase();
      if (cur && cur.code !== typed && !window.confirm("This replaces the unfinished exam on this device (" + cur.title + "). Continue?")) return;
      var msg = document.getElementById("codeMsg"); if (msg) msg.textContent = "Loading…";
      loadByCode(typed, function (err) { var m = document.getElementById("codeMsg"); if (err && m) m.textContent = err; });
    };
    bind("loadCode", codeLoad);
    var rc = document.getElementById("resumeCode");
    if (rc) rc.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") codeLoad(); });
    Array.prototype.forEach.call(app.querySelectorAll(".formgrid button"), function (b) {
      b.addEventListener("click", function () { start({ mode: "form", form: parseInt(b.getAttribute("data-form"), 10) }); });
    });
  }
  function nextForm(done) { for (var f = 1; f <= FORMS; f++) if (!done[f]) return f; return 1; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  function bind(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener("click", fn); }

  function start(opts) {
    var timed = opts.untimed ? false : !!(document.getElementById("timed") || {}).checked;
    var study = opts.study || !!(document.getElementById("study") || {}).checked;
    var ver = chosenVersion();
    state.exam = buildExam({ ver: ver, mode: opts.mode, form: opts.form, domain: opts.domain, count: opts.count, study: study,
      minutes: opts.mode === "drill" ? 0 : blueprint(ver).minutes, timed: timed });
    saveProgress(); renderExam(); startTimer();
    requestCode(state.exam);
  }

  /* Options of a single/multiple-choice item, or the drop-down rows of a Yes/No or matching item. */
  function renderBody(it, reveal, readonly) {
    var html = '';
    if (!isGrid(it)) {
      it.options.forEach(function (o, i) {
        var sel = it.chosen.indexOf(i) >= 0;
        if (readonly) {
          var rc = "opt disabled"; if (it.answer.indexOf(i) >= 0) rc += " correct"; else if (sel) rc += " wrong";
          html += '<div class="' + rc + '" style="cursor:default;opacity:1"><span class="letter">' + LETTERS[i] + '</span><span>' + esc(o) + (sel ? ' <span class="muted small">(your answer)</span>' : '') + '</span></div>';
          return;
        }
        var full = it.select > 1 && it.chosen.length >= it.select && !sel;
        var cls = "opt" + (sel ? " sel" : "") + (full && !reveal ? " disabled" : "");
        if (reveal) { if (it.answer.indexOf(i) >= 0) cls += " correct"; else if (sel) cls += " wrong"; }
        html += '<label class="' + cls + '" data-i="' + i + '"><input type="' + (it.select > 1 ? "checkbox" : "radio") + '" name="opt" ' + (sel ? "checked " : "") + ((full || reveal) ? "disabled " : "") + '>' +
          '<span class="letter">' + LETTERS[i] + '</span><span>' + esc(o) + '</span></label>';
      });
      return html;
    }
    var labels = it.type === "yesno" ? YESNO : it.options.map(function (_, i) { return LETTERS[i]; });
    if (it.type === "match") {
      html += '<div class="choices">' + it.options.map(function (o, i) { return '<div class="choice"><span class="letter">' + LETTERS[i] + '</span><span>' + esc(o) + '</span></div>'; }).join("") + '</div>';
    }
    html += '<div class="gridrows">';
    it.rows.forEach(function (row, r) {
      var c = it.chosen[r], show = reveal || readonly, cls = "gridrow";
      if (show) cls += c === it.answer[r] ? " correct" : " wrong";
      html += '<div class="' + cls + '"><span class="rownum">' + (r + 1) + '</span><span class="rowtext">' + esc(row) + '</span>' +
        '<select data-r="' + r + '" aria-label="Answer for ' + (it.type === "yesno" ? "statement " : "item ") + (r + 1) + '"' + (show ? ' disabled' : '') + '>' +
        '<option value="-1"' + (c < 0 ? ' selected' : '') + '>Select…</option>' +
        labels.map(function (l, i) { return '<option value="' + i + '"' + (c === i ? ' selected' : '') + '>' + l + '</option>'; }).join("") + '</select>' +
        (show && c !== it.answer[r] ? '<span class="rowans">Answer: ' + labels[it.answer[r]] + '</span>' : '') + '</div>';
    });
    return html + '</div>';
  }

  function renderExam() {
    state.view = "exam";
    var ex = state.exam, it = ex.items[ex.current], n = ex.items.length;
    var answered = ex.items.filter(isAnswered).length;
    var reveal = ex.study && it.checked;
    countEl.hidden = false; countEl.textContent = "Question " + (ex.current + 1) + " of " + n;
    var html = '<div class="row" style="margin-bottom:12px"><div><strong>' + esc(ex.title) + '</strong><div class="muted small">' + answered + ' of ' + n + ' answered' + (ex.study ? ' · study mode' : '') + (ex.minutes && !ex.timed ? ' · timer paused, ' + fmtTime(ex.minutes * 60 - elapsed(ex)) + ' left' : '') +
      (ex.code ? ' · <span title="Type this code on another device to continue this exam">Resume code: <strong class="rcode">' + esc(ex.code) + '</strong></span>' : '') + '</div></div><div class="spacer"></div>' +
      (ex.minutes ? '<label class="check" style="margin:0 8px 0 0"><input type="checkbox" id="limitToggle"' + (ex.timed ? ' checked' : '') + '> Time limit</label>' : '') +
      '<button class="btn" id="toHome">Save &amp; exit</button><button class="btn primary" id="submitBtn">' + (ex.study ? 'Finish' : 'Submit exam') + '</button></div>';

    html += '<div class="card"><div class="qhead"><span><strong>Question ' + (ex.current + 1) + '</strong> <span class="muted">of ' + n + '</span></span>' +
      '<span class="tag">' + esc(domainName(it.domain)) + '</span></div>' +
      '<div class="stem">' + esc(it.stem) + '</div>' +
      '<div class="instr">' + instruction(it) + '</div>' + renderBody(it, reveal, false);
    if (reveal) html += explBlock(it);
    html += '<div class="row" style="margin-top:14px"><button class="btn" id="prev" ' + (ex.current === 0 ? "disabled" : "") + '>← Previous</button>' +
      '<button class="btn ' + (it.flagged ? "flagged" : "") + '" id="flag">' + (it.flagged ? "⚑ Flagged" : "⚐ Flag") + '</button>' +
      (ex.study && !it.checked ? '<button class="btn" id="check" ' + (isAnswered(it) ? "" : "disabled") + '>Check answer</button>' : '') +
      '<div class="spacer"></div><button class="btn primary" id="next" ' + (ex.current === n - 1 ? "disabled" : "") + '>Next →</button></div></div>';

    html += '<div class="card"><h3>Navigator</h3><div class="navgrid">' + ex.items.map(function (x, i) {
      var c = []; if (isAnswered(x)) c.push("answered"); if (x.flagged) c.push("flag"); if (i === ex.current) c.push("current");
      if (ex.study && x.checked) c.push(isCorrect(x) ? "ok" : "no");
      return '<button data-q="' + i + '" class="' + c.join(" ") + '" aria-label="Question ' + (i + 1) + '">' + (i + 1) + '</button>';
    }).join("") + '</div><p class="muted small" style="margin-top:10px">Keys: A–E or 1–5 select · N next · P previous · F flag</p></div>';

    app.innerHTML = html;

    Array.prototype.forEach.call(app.querySelectorAll(".opt"), function (el) {
      el.addEventListener("click", function (e) { e.preventDefault(); choose(parseInt(el.getAttribute("data-i"), 10)); });
    });
    Array.prototype.forEach.call(app.querySelectorAll(".gridrow select"), function (el) {
      el.addEventListener("change", function () { setRow(parseInt(el.getAttribute("data-r"), 10), parseInt(el.value, 10)); });
    });
    Array.prototype.forEach.call(app.querySelectorAll(".navgrid button"), function (b) {
      b.addEventListener("click", function () { go(parseInt(b.getAttribute("data-q"), 10)); });
    });
    bind("prev", function () { go(ex.current - 1); });
    bind("next", function () { go(ex.current + 1); });
    bind("flag", function () { it.flagged = !it.flagged; saveProgress(); renderExam(); });
    bind("check", function () { it.checked = true; saveProgress(); renderExam(); });
    bind("toHome", function () { pauseClock(ex); saveProgress(); syncNow(); renderHome(); });
    var lt = document.getElementById("limitToggle");
    if (lt) lt.addEventListener("change", function () { setTimed(ex, lt.checked); });
    bind("submitBtn", function () {
      var left = ex.items.filter(function (i) { return !isAnswered(i); }).length;
      if (left && !ex.study && !window.confirm(left + " question(s) are unanswered or incomplete. Submit anyway?")) return;
      submit(false);
    });
  }

  function explBlock(it) {
    var ok = isCorrect(it);
    return '<div class="expl"><div class="verdict ' + (ok ? "ok" : "bad") + '">' + (ok ? "Correct" : "Incorrect") +
      ' · Answer: ' + answerText(it) + '</div>' + esc(it.explanation) + '</div>';
  }

  function choose(i) {
    var it = state.exam.items[state.exam.current];
    if (isGrid(it) || (state.exam.study && it.checked)) return;
    var pos = it.chosen.indexOf(i);
    if (it.select === 1) it.chosen = [i];
    else if (pos >= 0) it.chosen.splice(pos, 1);
    else if (it.chosen.length < it.select) it.chosen.push(i);
    saveProgress(); renderExam();
  }
  function setRow(r, v) {
    var it = state.exam.items[state.exam.current];
    if (!isGrid(it) || (state.exam.study && it.checked)) return;
    it.chosen[r] = v >= 0 && v < rowChoices(it).length ? v : -1;
    saveProgress(); renderExam();
  }
  function go(i) { var ex = state.exam; if (i < 0 || i >= ex.items.length) return; ex.current = i; saveProgress(); renderExam(); window.scrollTo(0, 0); }

  function submit(timeUp) {
    var ex = state.exam; if (!ex || ex.submitted) return;
    hideTopbarExtras();
    ex.submitted = true; ex.seconds = Math.round(elapsed(ex));
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    forgetCode(ex.code);
    var s = scored(ex), correct = s.filter(isCorrect).length;
    var pct = Math.round(100 * correct / Math.max(1, s.length));
    addHistory({ title: ex.title, ver: ex.ver, form: ex.mode === "form" ? ex.form : null, date: Date.now(), correct: correct, total: s.length, pct: pct, seconds: ex.seconds });
    renderResults(timeUp);
  }

  function renderResults(timeUp, filter) {
    state.view = "results"; filter = filter || "wrong"; hideTopbarExtras();
    var ex = state.exam, s = scored(ex), n = s.length, correct = s.filter(isCorrect).length, pct = Math.round(100 * correct / Math.max(1, n));
    var unscored = ex.items.length - n;
    var byDom = {};
    s.forEach(function (it) { var b = byDom[it.domain] = byDom[it.domain] || { c: 0, t: 0 }; b.t++; if (isCorrect(it)) b.c++; });

    var html = '<h1>' + esc(ex.title) + ' · Results</h1>' + (timeUp ? '<p class="fail">Time expired; the exam was submitted automatically.</p>' : '') +
      '<div class="grid2"><div class="card"><div class="score">' + pct + '%</div><p class="muted">' + correct + ' of ' + n + ' scored items correct · ' + fmtTime(ex.seconds || 0) + ' elapsed' +
      (unscored ? '<br>' + unscored + ' unscored trial items were left out (marked in the review below).' : '') + '</p>' +
      '<p class="small muted">Raw score, not the official 100–1,000 scale. These questions are deliberately harder than the real exam and have not been calibrated against it, so use scores to track your progress across forms and domains, not to predict an exam result.</p>' +
      '<div class="row"><button class="btn primary" id="again">Back to exams</button></div></div>' +
      '<div class="card"><h3>By domain</h3><table><tbody>' +
      Object.keys(byDom).sort().map(function (k) {
        var b = byDom[k], p = Math.round(100 * b.c / b.t);
        return '<tr><td>' + esc(domainName(parseInt(k, 10))) + '</td><td class="num">' + b.c + '/' + b.t + '</td><td style="width:90px"><div class="bar"><span style="width:' + p + '%"></span></div></td></tr>';
      }).join("") + '</tbody></table></div></div>';

    var list = ex.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (x) {
      return filter === "all" ? true : filter === "flagged" ? x.it.flagged : !isCorrect(x.it);
    });
    html += '<h2>Review</h2><div class="row" style="margin-bottom:12px">' +
      ['wrong', 'flagged', 'all'].map(function (f) { return '<button class="btn ' + (f === filter ? "primary" : "") + '" data-filter="' + f + '">' + { wrong: "Incorrect", flagged: "Flagged", all: "All" }[f] + '</button>'; }).join("") + '</div>';
    if (!list.length) html += '<p class="muted">Nothing to show for this filter.</p>';
    list.forEach(function (x) {
      var it = x.it;
      html += '<div class="card"><div class="qhead"><span><strong>Q' + (x.i + 1) + '</strong> <span class="pill ' + (isCorrect(it) ? "ok" : "bad") + '">' + (isCorrect(it) ? "Correct" : "Incorrect") + '</span>' +
        (it.unscored ? ' <span class="tag">unscored</span>' : '') + (it.flagged ? ' <span class="tag">⚑ flagged</span>' : '') + '</span><span class="tag">' + esc(domainName(it.domain)) + '</span></div>' +
        '<div class="stem">' + esc(it.stem) + '</div>' +
        (isGrid(it) || it.select > 1 ? '<div class="instr">' + instruction(it) + '</div>' : '') +
        renderBody(it, true, true) + explBlock(it) + '</div>';
    });
    app.innerHTML = html;
    bind("again", renderHome);
    Array.prototype.forEach.call(app.querySelectorAll("[data-filter]"), function (b) {
      b.addEventListener("click", function () { renderResults(false, b.getAttribute("data-filter")); });
    });
    window.scrollTo(0, 0);
  }

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    if (state.view !== "exam" || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "select" || tag === "textarea") return;
    var k = e.key.toUpperCase(), it = state.exam.items[state.exam.current];
    var idx = LETTERS.indexOf(k); if (idx < 0 && /^[1-5]$/.test(k)) idx = parseInt(k, 10) - 1;
    if (idx >= 0 && !isGrid(it) && idx < it.options.length) { choose(idx); e.preventDefault(); }
    else if (k === "N" || e.key === "ArrowRight") go(state.exam.current + 1);
    else if (k === "P" || e.key === "ArrowLeft") go(state.exam.current - 1);
    else if (k === "F") { it.flagged = !it.flagged; saveProgress(); renderExam(); }
  });
  document.getElementById("homeLink").addEventListener("click", function () {
    if (state.view === "exam") { pauseClock(state.exam); saveProgress(); syncNow(); }
    renderHome();
  });

  /* ---------- boot ---------- */
  fetch("data/bank.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
  }).then(function (data) { BANK = data; renderHome(); })
    .catch(function (err) { app.innerHTML = '<p class="fail">Could not load the question bank (' + esc(err.message) + ').</p>'; });

  window.__ccarp = { buildExam: function (o) { return buildExam(o); }, isCorrect: isCorrect, isAnswered: isAnswered, bank: function () { return BANK; } };
})();
