#!/usr/bin/env node
// Pro Remote · Copyright (C) 2026 Gavin Peppers · Contributors: Crossroads Community Church, Athens, GA
// SPDX-License-Identifier: GPL-3.0-or-later  (see LICENSE.txt and COPYRIGHT.txt)
/*
 * ProPresenter Network Remote
 * ---------------------------
 * A tiny, dependency-free server that:
 *   1. relays commands to ProPresenter's built-in network API (ProPresenter 7.9+)
 *   2. serves a browser-based control screen to computers on your network
 *   3. pushes live slide updates to every connected remote (Server-Sent Events)
 *
 * Run:  node server.js   then open the address it prints from any computer on the network
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// The demo keeps its own settings file so it never touches your real setup
const APP_VERSION = '1.2';   // keep in step with PAGE_VERSION in public/index.html
// Where settings and saved reports live: next to this file, or (for the Mac app) in the user's
// Application Support folder, passed in as PRO_REMOTE_DATA
const DATA_DIR = process.env.PRO_REMOTE_DATA || __dirname;
const CONFIG_FILE = process.env.PRO_REMOTE_CONFIG || path.join(DATA_DIR, 'config.json');
const DEMO = !!process.env.PRO_REMOTE_DEMO;
const DEFAULTS = {
  proHost: '127.0.0.1', // where ProPresenter is running
  proPort: 1025,        // ProPresenter > Settings > Network > Port
  remotePort: 4316,     // port this remote is served on (open http://<this computer>:4316)
  users: [],            // people who can use the remote: { name, pin, level } ([] = open to anyone on the network)
  autoOpenBrowser: false // set true in config.json to open the remote in this computer's browser on start
};

let config = { ...DEFAULTS, users: [] };
let firstRun = false;
try {
  config = { ...DEFAULTS, users: [], ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
} catch (_) { firstRun = !fs.existsSync(CONFIG_FILE); /* first run: use defaults */ }
delete config.openBrowser;
// The remote used to run on 8080 (a port lots of other programs use too); move older setups to 4316
if (config.remotePort === 8080) { config.remotePort = 4316; try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (_) {} }

const startupOnly = {};   // settings given when starting (REMOTE_PORT etc.): used, but not saved over the file's own
function saveConfig() {
  const out = { ...config };
  for (const [k, v] of Object.entries(startupOnly)) if (config[k] === v.used) out[k] = v.file;
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2)); } catch (e) {
    console.error('Could not save config.json:', e.message);
  }
}

if (!Array.isArray(config.users)) config.users = [];
// Before 1.2 there was one shared PIN; it becomes a person called "Admin" with that PIN
if (config.pin && !config.users.length) {
  config.users.push({ name: 'Admin', pin: String(config.pin), level: 'admin' });
  config.pinMoved = true;
}
if ('pin' in config) { delete config.pin; saveConfig(); }
// A new install starts protected: an Admin with a made-up PIN, shown in the Pro Remote window
// until it's changed. (Not a fixed default PIN: that would be printed for anyone to read.)
if (firstRun && !DEMO && !config.users.length) {
  const pin = String(require('crypto').randomInt(100000, 1000000));
  config.users.push({ name: 'Admin', pin, level: 'admin', starterPin: true });
  saveConfig();
}

// Settings given when starting (not saved)
for (const [key, env, num] of [['proHost', 'PRO_HOST'], ['proPort', 'PRO_PORT', 1], ['remotePort', 'REMOTE_PORT', 1]]) {
  if (!process.env[env]) continue;
  const used = num ? Number(process.env[env]) : process.env[env];
  startupOnly[key] = { file: config[key], used };
  config[key] = used;
}

const proBase = () => `http://${config.proHost}:${config.proPort}`;

// Recent Terminal lines (commands, failures, notices), included in problem reports
const recentLog = [];
function logLine(line) {
  console.log(line);
  recentLog.push(`${new Date().toLocaleString()}  ${line.trim()}`);
  if (recentLog.length > 80) recentLog.shift();
}

const { spawn } = require('child_process');

// ---------- talking to ProPresenter ----------
async function pro(pathname, { method = 'GET', body, timeout = 4000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(proBase() + pathname, {
      method,
      body,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      signal: ctrl.signal
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function proJson(pathname, timeout) {
  const res = await pro(pathname, timeout ? { timeout } : undefined);
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- live state, broadcast to remotes ----------
// Two ways of keeping up with ProPresenter:
//  - instant updates: one long connection (POST /v1/status/updates); ProPresenter sends a message whenever
//    something we listed changes
//  - regular checks: ask every 400 ms. Used for anything the instant updates don't cover, as a safety net
//    every few seconds, and for everything if instant updates aren't available or the connection drops.
const state = {
  connected: false,
  version: null,
  slide: null,        // { current: {text, notes, uuid}, next: {...} }
  slideIndex: null,   // { presentation_index: { index, presentation_id: { uuid, name } } }
  transport: { presentation: {}, announcement: {}, audio: {} },  // media playback: { current, time }
  liveUpdates: 'checks', // 'instant' when the update stream is running
  error: null
};
let lastBroadcast = '';
const clients = new Set();

const publicState = () => ({ ...state, proHost: config.proHost, proPort: config.proPort, demo: DEMO, appVersion: APP_VERSION });

function broadcast(force = false) {
  const payload = JSON.stringify(publicState());
  if (!force && payload === lastBroadcast) return;
  lastBroadcast = payload;
  for (const res of clients) res.write(`data: ${payload}\n\n`);
}

// Everything we keep up with: ProPresenter's address (without /v1/) -> where it goes in state
const TP_LAYERS = ['presentation', 'announcement', 'audio'];
const bool = v => typeof v === 'boolean' ? v : null;
const WATCH = {
  'status/slide':            v => { state.slide = v; },
  'presentation/slide_index':v => { state.slideIndex = v; },
  'status/layers':           v => { state.layers = v; },      // { slide, media, props, ... } booleans
  'status/audience_screens': v => { state.audienceScreens = bool(v); },
  'status/stage_screens':    v => { state.stageScreens = bool(v); },
  'playlist/focused':        v => { state.focused = v; },     // used for Planning Center plans
  'look/current':            v => { state.look = v; },
  'capture/status':          v => { state.capture = v; }
};
for (const L of TP_LAYERS) {
  WATCH[`transport/${L}/current`] = v => { state.transport[L].current = v; };
  WATCH[`transport/${L}/time`] = v => { state.transport[L].time = v; };
}
const ALL_KEYS = Object.keys(WATCH);
const CORE_KEYS = ['status/slide', 'presentation/slide_index', 'status/layers'];
const isTransport = k => k.startsWith('transport/');

const stream = { ok: false, ctrl: null, seen: new Set(), retryAt: 0, notice: '' };
const SAFETY_NET_MS = 5000;   // while instant updates run, still check everything this often
let lastFull = 0, lastTransport = 0;

// Runs jobs a few at a time, so a busy ProPresenter isn't hit with a dozen requests at once
async function limited(jobs, n = 4) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

let pollBusy = false, pollAgain = false, failStreak = 0;
const DROP_AFTER = 3;   // only show "not connected" after this many checks in a row get no answer
async function poll(force = false) {
  if (pollBusy) { pollAgain = pollAgain || force; return; }   // one check at a time
  pollBusy = true;
  const now = Date.now();
  try {
    if (!state.connected || !state.version) state.version = await proJson('/version', 6000);
    const full = force || !stream.ok || now - lastFull >= SAFETY_NET_MS;
    const doTransport = force || now - lastTransport >= 900;    // playback times: about once a second is plenty
    const keys = ALL_KEYS.filter(k => (full || !stream.seen.has(k)) && (!isTransport(k) || doTransport));
    if (full) lastFull = now;
    if (doTransport) lastTransport = now;
    let netFails = 0, lastErr = null;
    const results = await limited(keys.map(k => () => proJson('/v1/' + k, 6000).then(v => ({ ok: true, v })).catch(e => {
      if (/HTTP \d+/.test(e.message)) return { ok: true, v: null };   // ProPresenter answered "nothing here"
      netFails++; lastErr = e; return { ok: false };                     // no answer: keep what we had
    })));
    if (keys.length && netFails === keys.length) throw lastErr || new Error('ProPresenter stopped answering');
    keys.forEach((k, i) => { if (results[i].ok) WATCH[k](results[i].v); });
    if (!state.connected || failStreak) logLine(`  Connected to ProPresenter at ${config.proHost}:${config.proPort}`);
    failStreak = 0;
    state.connected = true;
    state.error = null;
  } catch (e) {
    failStreak++;
    const why = e.name === 'AbortError' || e.name === 'TimeoutError'
      ? `No response from ProPresenter at ${config.proHost}:${config.proPort}`
      : `Can't reach ProPresenter at ${config.proHost}:${config.proPort} (${e.cause?.code || e.message})`;
    if (failStreak === DROP_AFTER || (!state.connected && failStreak === 1)) logLine(`  Lost connection: ${why}`);
    if (failStreak >= DROP_AFTER || !state.connected) {   // a single slow answer doesn't count as a disconnect
      state.connected = false;
      state.version = null;
      stopStream();
      state.error = why;
    }
  } finally {
    pollBusy = false;
  }
  broadcast();
  if (pollAgain) { const f = pollAgain; pollAgain = false; setTimeout(() => poll(f), 0); }
}

// Splits a stream of text into whole JSON objects, whatever ProPresenter puts between them
function jsonSplitter(onObject) {
  let buf = '', depth = 0, inStr = false, esc = false, start = -1, i = 0;
  return text => {
    buf += text;
    for (; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') { if (depth++ === 0) start = i; }
      else if (c === '}' && depth > 0 && --depth === 0) {
        try { onObject(JSON.parse(buf.slice(start, i + 1))); } catch (_) {}
        buf = buf.slice(i + 1); i = -1; start = -1;
      }
    }
    if (depth === 0) { buf = ''; i = 0; }
  };
}

function setStreamNotice(msg) { if (msg !== stream.notice) { stream.notice = msg; logLine('  ' + msg); } }

function stopStream() {
  if (stream.ctrl) stream.ctrl.abort();
  stream.ctrl = null; stream.ok = false; stream.seen = new Set();
  state.liveUpdates = 'checks';
}

// Opens the instant-updates line. Resolves to the response, or null if ProPresenter refused / couldn't be reached.
// (Plain http here: it has no "give up when quiet" timer, and the line can be quiet for a long time.)
function openUpdates(list, onAbortReady) {
  return new Promise(resolve => {
    const body = JSON.stringify(list);
    const req = http.request({
      host: config.proHost, port: config.proPort, path: '/v1/status/updates', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => resolve({ req, res }));
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); });   // only until ProPresenter answers; cleared below
    onAbortReady(() => req.destroy());
    req.end(body);
  });
}

async function startStream() {
  if (stream.ctrl || !state.connected) return;
  for (const list of [ALL_KEYS, CORE_KEYS]) {       // if ProPresenter refuses the full list, try the basics
    const ctrl = { abort: () => {} };
    stream.ctrl = ctrl;
    const got = await openUpdates(list, fn => { ctrl.abort = fn; });
    if (stream.ctrl !== ctrl) { if (got) got.req.destroy(); return; }   // stopped while connecting
    if (!got) { stream.ctrl = null; stream.retryAt = Date.now() + 3000; return; }
    const { req, res } = got;
    if (res.statusCode !== 200) { res.resume(); req.destroy(); continue; }
    req.setTimeout(0);
    stream.ok = true; stream.seen = new Set();
    state.liveUpdates = 'instant';
    setStreamNotice('Instant updates: ON');
    broadcast();
    const split = jsonSplitter(msg => {
      const key = String(msg.url || '').replace(/^\/?(v1\/)?/, '').replace(/\?.*$/, '');
      if (!WATCH[key] || !('data' in msg)) return;
      stream.seen.add(key);
      WATCH[key](msg.data);
      if (!bcastSoon) bcastSoon = setTimeout(() => { bcastSoon = null; broadcast(); }, 60);   // group bursts together
    });
    res.setEncoding('utf8');
    res.on('data', split);
    await new Promise(done => { res.on('end', done); res.on('close', done); res.on('error', done); req.on('error', done); });
    if (stream.ctrl === ctrl) {      // ended on its own: fall back to regular checks and try again shortly
      stream.ctrl = null; stream.ok = false; stream.seen = new Set();
      state.liveUpdates = 'checks';
      setStreamNotice('Instant updates dropped, using regular checks until they reconnect');
      stream.retryAt = Date.now() + 3000;
      broadcast();
    }
    return;
  }
  stream.ctrl = null;
  setStreamNotice("This ProPresenter doesn't offer instant updates; using regular checks");
  stream.retryAt = Date.now() + 60000;
}

let bcastSoon = null;
let pollTimer;
async function pollLoop() {
  await poll();
  if (state.connected && !stream.ctrl && Date.now() >= stream.retryAt) startStream();
  pollTimer = setTimeout(pollLoop, state.connected ? 400 : 2000);
}

// ---------- problem reports ----------
// "Report a problem" in the remote sends here. Every report is saved in the "reports" folder next to this
// file first, then emailed. If there's no internet (or email isn't set up yet) it stays in reports/outbox
// and is retried every few minutes. Email settings live in report-settings.json.
const reports = (() => {
  const DIR = path.join(DATA_DIR, 'reports'), OUTBOX = path.join(DIR, 'outbox'), SENT = path.join(DIR, 'sent');
  const SETTINGS_FILE = fs.existsSync(path.join(DATA_DIR, 'report-settings.json')) ? path.join(DATA_DIR, 'report-settings.json') : path.join(__dirname, 'report-settings.json');
  const MIN_GAP_MS = 60 * 1000;           // one report a minute, so nobody floods the inbox by accident
  let lastAccepted = 0, sending = false;
  const settings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; } };
  const ready = () => { const s = settings(); return !!(s.service && (s.sendTo || s.accessKey)); };
  const ensure = () => { for (const d of [DIR, OUTBOX, SENT]) fs.mkdirSync(d, { recursive: true }); };
  const clip = (v, n) => String(v ?? '').slice(0, n);

  function build(body, req) {
    const d = body.details || {};
    const now = new Date();
    const id = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
    const report = {
      id, when: now.toString(), demo: DEMO,
      what: clip(body.what, 4000), trying: clip(body.trying, 4000),
      name: clip(body.name, 120), email: clip(body.email, 200),
      remote: {
        appVersion: APP_VERSION, helperComputer: `${os.hostname()} · ${os.type()} ${os.release()} · Node ${process.version}`,
        proPresenter: `${state.version?.name || '?'} ${state.version?.host_description || ''} at ${config.proHost}:${config.proPort}`,
        connected: state.connected, liveUpdates: state.liveUpdates, helperError: state.error || '',
        sentFrom: `${req.socket.remoteAddress || '?'}`,
        signedInAs: clip(body.signedInAs, 80)
      },
      page: d,                               // browser, screen size, what was live, recent page errors
      terminalLog: recentLog.slice(-60)
    };
    return report;
  }

  function asText(r) {
    const p = r.page || {}, live = p.live || {};
    const lines = [
      `${r.demo ? '[DEMO] ' : ''}Pro Remote problem report`, `When: ${r.when}`, '',
      'WHAT HAPPENED', r.what || '(not filled in)', '',
      'WHAT THEY WERE TRYING TO DO', r.trying || '(not filled in)', '',
      `From: ${r.name || '(no name)'}${r.email ? ' <' + r.email + '>' : ''}`, '',
      'SETUP',
      `Pro Remote ${r.remote.appVersion}`, `Helper computer: ${r.remote.helperComputer}`,
      r.remote.signedInAs ? `Signed in as: ${r.remote.signedInAs}` : null,
      `ProPresenter: ${r.remote.proPresenter}`, `Connected: ${r.remote.connected} · Updates: ${r.remote.liveUpdates}`,
      r.remote.helperError ? `Helper error: ${r.remote.helperError}` : '',
      `Browser: ${p.browser || '?'}`, `Window: ${p.window || '?'}`, '',
      'ON SCREEN AT THE TIME',
      ...Object.entries(live).map(([k, v]) => `${k}: ${v && typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · ') : v}`), '',
      'RECENT PAGE ERRORS', ...((p.errors || []).length ? p.errors : ['(none)']), '',
      'RECENT TERMINAL LOG', ...(r.terminalLog.length ? r.terminalLog : ['(empty)'])
    ];
    return lines.filter(l => l !== null).join('\n');
  }

  // Sends one saved report. Resolves true if it went out.
  async function deliver(id) {
    const s = settings();
    const r = JSON.parse(fs.readFileSync(path.join(OUTBOX, id + '.json'), 'utf8'));
    const shotFile = path.join(OUTBOX, id + '.jpg');
    const shot = fs.existsSync(shotFile) ? fs.readFileSync(shotFile) : null;
    const subject = `${r.demo ? '[DEMO] ' : ''}Pro Remote problem: ${(r.what || 'no description').replace(/\s+/g, ' ').slice(0, 70)}`;
    const text = asText(r);
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
    try {
      let res;
      if (s.service === 'formsubmit') {
        // FormSubmit: free, sends attachments. First report triggers a one-time "activate" email to sendTo.
        const fd = new FormData();
        fd.append('_subject', subject); fd.append('_template', 'box'); fd.append('_captcha', 'false');
        if (r.email) fd.append('_replyto', r.email);
        fd.append('Report', text);
        if (shot) fd.append('attachment', new Blob([shot], { type: 'image/jpeg' }), `screenshot-${id}.jpg`);
        res = await fetch(s.endpoint || `https://formsubmit.co/${encodeURIComponent(s.sendTo)}`, { method: 'POST', body: fd, signal: ctrl.signal, redirect: 'manual',
          headers: { Referer: 'http://pro-remote.local/', Origin: 'http://pro-remote.local' } });
        return res.status < 400;
      }
      if (s.service === 'web3forms') {
        // Web3Forms free plan can't attach files: the screenshot stays in the reports folder on this computer
        res = await fetch('https://api.web3forms.com/submit', { method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ access_key: s.accessKey, subject, from_name: 'Pro Remote', replyto: r.email || undefined,
            message: text + (shot ? `\n\n(Screenshot saved on the helper computer: reports/sent/${id}.jpg)` : '') }) });
        return res.ok;
      }
      return false;
    } catch (_) { return false; } finally { clearTimeout(t); }
  }

  async function flush() {
    if (sending || !ready()) return;
    sending = true;
    try {
      ensure();
      for (const f of fs.readdirSync(OUTBOX).filter(f => f.endsWith('.json')).sort()) {
        const id = f.slice(0, -5);
        if (!(await deliver(id))) break;     // offline or refused: try again later
        for (const ext of ['.json', '.jpg', '.txt']) {
          const from = path.join(OUTBOX, id + ext);
          if (fs.existsSync(from)) fs.renameSync(from, path.join(SENT, id + ext));
        }
        logLine(`  Problem report ${id} emailed`);
      }
    } catch (e) { console.error('Report sending:', e.message); }
    sending = false;
  }
  setInterval(flush, 5 * 60 * 1000).unref();
  setTimeout(flush, 15000).unref();

  async function submit(body, req) {
    const wait = lastAccepted + MIN_GAP_MS - Date.now();
    if (wait > 0) return { status: 'wait', seconds: Math.ceil(wait / 1000) };
    if (!String(body.what || '').trim()) return { status: 'error', message: 'Please say what happened.' };
    lastAccepted = Date.now();
    ensure();
    const r = build(body, req);
    fs.writeFileSync(path.join(OUTBOX, r.id + '.json'), JSON.stringify(r, null, 2));
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(body.screenshot || ''));
    if (m) fs.writeFileSync(path.join(OUTBOX, r.id + '.jpg'), Buffer.from(m[1], 'base64'));
    fs.writeFileSync(path.join(OUTBOX, r.id + '.txt'), asText(r));   // easy to read on this computer
    logLine(`  Problem report ${r.id} saved${r.what ? ': ' + r.what.replace(/\s+/g, ' ').slice(0, 60) : ''}`);
    if (!ready()) return { status: 'saved', id: r.id, text: asText(r), sendTo: settings().sendTo || '' };
    await flush();
    const still = fs.existsSync(path.join(OUTBOX, r.id + '.json'));
    return still ? { status: 'queued', id: r.id, text: asText(r), sendTo: settings().sendTo || '' } : { status: 'sent', id: r.id };
  }

  return { submit, info: () => ({ ready: ready(), demo: DEMO }) };
})();

// ---------- HTTP server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      chunks.push(c);
      if ((size += c.length) > limit) req.destroy();
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- people and access levels ----------
// Each person has their own PIN and one of four levels. With nobody added, the remote is open
// to anyone on the network (everyone is Admin). The computer running the remote is always Admin.
const LEVELS = ['viewer', 'slides', 'operator', 'admin'];
const LEVEL_NAMES = { viewer: 'Viewer', slides: 'Slides only', operator: 'Operator', admin: 'Admin' };
const lv = level => Math.max(0, LEVELS.indexOf(level));
const SIGN_OUT_AFTER = Number(process.env.PRO_REMOTE_IDLE_MS) || 3 * 24 * 3600e3;   // 3 days without use
const LOCAL_ADMIN = !process.env.PRO_REMOTE_NO_LOCAL_ADMIN;                         // (switched off only in tests)
const SESSIONS_FILE = CONFIG_FILE.replace(/\.json$/i, '') + '-sessions.json';

let sessions = {};   // token -> { name, lastActive }
try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) || {}; } catch (_) {}
let sessionsTimer;
function saveSessions() {
  clearTimeout(sessionsTimer);
  sessionsTimer = setTimeout(() => {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions)); } catch (e) { console.error('Could not save sign-ins:', e.message); }
  }, 300);
}
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const findUser = name => config.users.find(u => sameName(u.name, name));
const isLocal = req => /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(String(req.socket.remoteAddress || ''));
const ipOf = req => String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');

const expiredTokens = new Set();    // so a remote signed out for not being used can say why
const replacedTokens = new Set();   // ...or because that person signed in on another computer
// Everyone but Admins can be signed in on one computer at a time (a second sign-in is refused at /signin).
// When an Admin is changed to another level, this keeps only their newest sign-in.
function oneComputerOnly(name, keepToken) {
  const user = findUser(name);
  if (!user || user.level === 'admin') return 0;
  let n = 0;
  for (const [tok, s] of Object.entries(sessions)) {
    if (tok === keepToken || !sameName(s.name, name)) continue;
    delete sessions[tok]; replacedTokens.add(tok); n++;
    for (const r of remoteInfo.values()) if (r.token === tok) { r.reason = 'signed in on another computer'; try { r.res.destroy(); } catch (_) {} }
    logLine(`  ${new Date().toLocaleTimeString()}  ${user.name} signed out on ${s.ip || 'another computer'} (no longer an Admin; one computer at a time)`);
  }
  if (n) saveSessions();
  return n;
}
// Who is making this request, and what may they do?
function identify(req, url) {
  if (!config.users.length) return { ok: true, open: true, level: 'admin', name: '' };
  const token = String(req.headers['x-remote-token'] || url.searchParams.get('t') || '');
  const s = token && Object.prototype.hasOwnProperty.call(sessions, token) ? sessions[token] : null;
  const user = s && findUser(s.name);
  if (s && !user) { delete sessions[token]; saveSessions(); }
  let expired = !s && expiredTokens.has(token);
  const replaced = !s && replacedTokens.has(token);
  if (user && Date.now() - s.lastActive > SIGN_OUT_AFTER) {
    delete sessions[token]; saveSessions(); expired = true; expiredTokens.add(token);
    logLine(`  ${new Date().toLocaleTimeString()}  ${user.name} was signed out on ${ipOf(req)} (3 days without use)`);
  } else if (user) return { ok: true, name: user.name, level: user.level, token, session: s };
  if (LOCAL_ADMIN && isLocal(req)) return { ok: true, local: true, level: 'admin', name: '', expired, replaced };
  return { ok: false, expired, replaced };
}
// Using the remote (opening it, pressing anything) keeps a sign-in going for another 3 days
function touch(who) {
  if (who && who.session) { who.session.lastActive = Date.now(); saveSessions(); }
}
const whoName = who => who.name || (who.local ? 'this computer' : '');

// The level a ProPresenter request needs. Reads are open to every level.
function needLevel(method, t) {
  t = t.split('?')[0];
  if (method !== 'GET') {
    if (/^\/v1\/looks?(\/|$)/.test(t)) return 'admin';                       // add / edit / delete Looks
    if (/^\/v1\/status\/(audience|stage)_screens/.test(t)) return 'admin';   // screens on / off
    if (/^\/v1\/capture\//.test(t)) return 'admin';
    if (/^\/v1\/(stage\/message|stage\/screen\/|transport\/|timers?\/)/.test(t)) return 'operator';
    return 'admin';                                                           // anything else that changes ProPresenter
  }
  if (/^\/v1\/capture\/(start|stop)/.test(t)) return 'admin';
  if (/^\/v1\/trigger\/(next|previous)$|^\/v1\/trigger\/cue\/|^\/v1\/trigger\/playlist\/|^\/v1\/playlist\/.+\/trigger$|^\/v1\/presentation\/.+\/trigger(\/|$)|^\/v1\/clear\/(layer|group)\//.test(t)) return 'slides';
  if (/trigger|\/clear|\/(next|previous)$|\/operation|\/(start|stop|reset)$|\/stage\/screen\/[^/]+\/layout\/[^/?]+|\/transport\/[^/]+\/(play|pause|skip_forward|skip_backward|go_to_end)/.test(t)) return 'operator';
  return 'viewer';
}

// Wrong PINs: after 5 from one computer, it waits a minute
const failedSignIns = new Map();   // ip -> { n, until }

// Adding and changing people (from the Pro Remote window, or by an Admin in Settings)
function changeUsers(op, a, by) {
  const users = config.users;
  const name = String(a.name || '').trim().replace(/\s+/g, ' ');
  const user = findUser(name);
  const admins = users.filter(u => u.level === 'admin');
  const checkPin = (pin, except) => {
    pin = String(pin || '').trim();
    if (!/^\d{4,12}$/.test(pin)) return [null, 'A PIN is 4 to 12 numbers.'];
    if (users.some(u => u !== except && u.pin === pin)) return [null, 'Someone already has that PIN. Each person needs their own.'];
    return [pin];
  };
  const by_ = by ? ` (by ${by})` : '';
  const t = new Date().toLocaleTimeString();
  if (op === 'add') {
    if (!name || name.length > 30) return { error: 'Give a name, up to 30 characters.' };
    if (user) return { error: `There's already someone called ${user.name}.` };
    const level = String(a.level || '').toLowerCase();
    if (!LEVELS.includes(level)) return { error: 'The level must be viewer, slides, operator or admin.' };
    if (!users.length && level !== 'admin') return { error: 'The first person added must be an Admin, so someone can manage access.' };
    const [pin, err] = checkPin(a.pin); if (err) return { error: err };
    users.push({ name, pin, level }); saveConfig();
    logLine(`  ${t}  Added ${name} (${LEVEL_NAMES[level]})${by_}`);
    return { ok: true };
  }
  if (!user) return { error: `Nobody called "${name}".` };
  const onlyAdmin = user.level === 'admin' && admins.length === 1 && users.length > 1;
  if (op === 'remove') {
    if (onlyAdmin) return { error: `${user.name} is the only Admin. Make someone else an Admin first.` };
    config.users = users.filter(u => u !== user); saveConfig();
    signOut(user.name);
    logLine(`  ${t}  Removed ${user.name}${by_}` + (config.users.length ? '' : '. Nobody is left, so the remote is open to anyone on the network.'));
    return { ok: true };
  }
  if (op === 'level') {
    const level = String(a.level || '').toLowerCase();
    if (!LEVELS.includes(level)) return { error: 'The level must be viewer, slides, operator or admin.' };
    if (onlyAdmin && level !== 'admin') return { error: `${user.name} is the only Admin. Make someone else an Admin first.` };
    user.level = level; saveConfig();
    if (level !== 'admin') {
      const newest = Object.entries(sessions).filter(([, x]) => sameName(x.name, user.name)).sort((a, b) => b[1].lastActive - a[1].lastActive)[0];
      if (newest) oneComputerOnly(user.name, newest[0]);
    }
    logLine(`  ${t}  ${user.name} is now ${LEVEL_NAMES[level]}${by_}`);
    return { ok: true };
  }
  if (op === 'pin') {
    const [pin, err] = checkPin(a.pin, user); if (err) return { error: err };
    user.pin = pin; delete user.starterPin; saveConfig();
    signOut(user.name);   // a new PIN signs them out everywhere, in case the old one got around
    logLine(`  ${t}  ${user.name}'s PIN was changed${by_}`);
    return { ok: true };
  }
  if (op === 'signout') {
    const n = signOut(user.name);
    logLine(`  ${t}  Signed out ${user.name} (${n} sign-in${n === 1 ? '' : 's'})${by_}`);
    return { ok: true };
  }
  return { error: 'Unknown change' };
}
function signOut(name) {
  let n = 0;
  for (const [tok, s] of Object.entries(sessions)) if (sameName(s.name, name)) { delete sessions[tok]; n++; }
  saveSessions();
  // close their open remotes; they reconnect and are asked for a PIN
  for (const r of remoteInfo.values()) if (r.user && sameName(r.user, name)) { r.reason = 'signed out'; try { r.res.destroy(); } catch (_) {} }
  return n;
}
function signedInCount(name) {
  return Object.values(sessions).filter(s => sameName(s.name, name) && Date.now() - s.lastActive <= SIGN_OUT_AFTER).length;
}
function lastUsed(name) {
  let last = 0;
  for (const s of Object.values(sessions)) if (sameName(s.name, name)) last = Math.max(last, s.lastActive);
  return last;
}
// Remotes left open past 3 days without use are closed, so they ask for the PIN again
setInterval(() => {
  for (const r of remoteInfo.values()) {
    if (!r.token) continue;
    const s = sessions[r.token];
    if (!s || Date.now() - s.lastActive > SIGN_OUT_AFTER) { r.reason = 'signed out'; try { r.res.destroy(); } catch (_) {} }
  }
}, Math.min(60000, SIGN_OUT_AFTER / 4)).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // --- who am I? (always reachable) ---
    if (p === '/auth') {
      const who = identify(req, url);
      return send(res, who.ok ? 200 : 401, {
        ok: who.ok, open: !!who.open, local: !!who.local, expired: !!who.expired, replaced: !!who.replaced,
        name: who.name || '', level: who.ok ? who.level : '', levelName: who.ok ? LEVEL_NAMES[who.level] : '',
        idleDays: Math.round(SIGN_OUT_AFTER / 864e5 * 10) / 10
      });
    }

    // --- sign in with your PIN ---
    if (p === '/signin' && req.method === 'POST') {
      const ip = ipOf(req), f = failedSignIns.get(ip);
      if (f && f.until > Date.now()) return send(res, 429, { error: 'Too many wrong PINs. Wait a minute and try again.' });
      let body = {};
      try { body = JSON.parse((await readBody(req)).toString() || '{}'); } catch (_) {}
      const pin = String(body.pin || '').trim();
      const user = pin && config.users.find(u => u.pin === pin);
      if (!user) {
        const n = (f && f.until <= Date.now() && f.n >= 5 ? 0 : (f ? f.n : 0)) + 1;
        failedSignIns.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        logLine(`  ${new Date().toLocaleTimeString()}  Wrong PIN from ${ip}`);
        return send(res, 401, { error: n >= 5 ? 'Too many wrong PINs. Wait a minute and try again.' : "That PIN isn't right." });
      }
      failedSignIns.delete(ip);
      // Everyone but Admins can be signed in on one computer at a time. A PIN never signs anyone out
      // (so someone who learned it can't take over): it's refused until that sign-in ends.
      if (user.level !== 'admin' && signedInCount(user.name) > 0) {
        const where = Object.values(sessions).find(x => sameName(x.name, user.name) && Date.now() - x.lastActive <= SIGN_OUT_AFTER);
        logLine(`  ${new Date().toLocaleTimeString()}  ${user.name}'s PIN was used on ${ip}, but ${user.name} is already signed in on ${where?.ip || 'another computer'}. Refused.`);
        return send(res, 409, { error: 'This PIN is already in use on another computer. Sign out there first, or ask an Admin to sign you out.' });
      }
      const token = require('crypto').randomBytes(24).toString('base64url');
      sessions[token] = { name: user.name, lastActive: Date.now(), ip };
      saveSessions();
      logLine(`  ${new Date().toLocaleTimeString()}  ${user.name} (${LEVEL_NAMES[user.level]}) signed in on ${ip}`);
      return send(res, 200, { ok: true, token, name: user.name, level: user.level, levelName: LEVEL_NAMES[user.level] });
    }
    if (p === '/signout' && req.method === 'POST') {
      const token = String(req.headers['x-remote-token'] || '');
      const s = token && Object.prototype.hasOwnProperty.call(sessions, token) ? sessions[token] : null;
      if (s) {
        delete sessions[token]; saveSessions();
        logLine(`  ${new Date().toLocaleTimeString()}  ${s.name} signed out on ${ipOf(req)}`);
      }
      return send(res, 200, { ok: true });
    }

    // --- an open remote checking in (so remotes that vanish, e.g. a computer asleep, are noticed) ---
    if (p === '/alive' && req.method === 'POST') {
      const cid = url.searchParams.get('cid');
      let found = false;
      for (const r of remoteInfo.values()) {
        if (cid && r.cid === cid) { r.lastSeen = Date.now(); r.hidden = url.searchParams.has('hidden'); found = true; }
      }
      // someone pressed something on this remote since its last check-in: that's use, for the 3-day rule
      if (found && url.searchParams.has('used')) touch(identify(req, url));
      res.writeHead(found ? 204 : 404, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    // --- static files ---
    if (!p.startsWith('/pp/') && !['/events', '/config', '/report', '/users'].includes(p)) {
      const file = p === '/' ? 'index.html' : p.slice(1);
      const full = path.join(__dirname, 'public', path.normalize(file));
      if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Forbidden', 'text/plain');
      return fs.readFile(full, (err, data) => {
        if (err) return send(res, 404, 'Not found', 'text/plain');
        send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
      });
    }

    const who = identify(req, url);
    if (!who.ok) return send(res, 401, {
      error: who.replaced ? 'Signed in on another computer' : who.expired ? 'Signed out after 3 days without use' : 'PIN required',
      expired: !!who.expired, replaced: !!who.replaced
    });
    const allowed = level => lv(who.level) >= lv(level);
    const refuse = () => send(res, 403, { error: `${LEVEL_NAMES[who.level]} access can't do that`, level: who.level });

    // --- live updates ---
    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      touch(who);
      const r = describeRemote(req);
      r.cid = url.searchParams.get('cid') || '';   // older pages don't check in, so they're never timed out
      r.lastSeen = Date.now(); r.hidden = false;
      r.res = res;
      r.user = who.name || ''; r.token = who.token || '';
      if (r.user) r.label = `${r.user} on ${r.label}`;
      remoteInfo.set(res, r);
      logLine(`  ${new Date().toLocaleTimeString()}  Remote opened: ${r.label}.  ${remotesSummary()}`);
      res.write(`data: ${JSON.stringify(publicState())}\n\n`);
      const ka = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ka); clients.delete(res); remoteInfo.delete(res);
        logLine(`  ${new Date().toLocaleTimeString()}  Remote closed${r.reason ? ` (${r.reason})` : ''}: ${r.label}.  ${remotesSummary()}`);
      });
      return;
    }

    // --- settings ---
    if (p === '/config') {
      if (req.method === 'GET') {
        return send(res, 200, { proHost: config.proHost, proPort: config.proPort });
      }
      if (req.method === 'POST') {
        if (!allowed('admin')) return refuse();
        touch(who);
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (body.proHost) config.proHost = String(body.proHost).trim();
        if (body.proPort) config.proPort = Number(body.proPort);
        saveConfig();
        state.connected = false;
        state.version = null;
        stopStream(); stream.retryAt = 0; stream.notice = '';
        lastBroadcast = '';   // make sure the next status goes out to every remote
        clearTimeout(pollTimer);
        pollLoop();
        return send(res, 200, { ok: true });
      }
    }

    // --- people (Admins only) ---
    if (p === '/users') {
      if (!allowed('admin')) return refuse();
      if (req.method === 'GET') {
        return send(res, 200, {
          open: !config.users.length,
          levels: LEVELS.map(id => ({ id, name: LEVEL_NAMES[id] })),
          users: config.users.map(u => ({
            name: u.name, pin: u.pin, level: u.level, levelName: LEVEL_NAMES[u.level], lastUsed: lastUsed(u.name) || null,
            signedIn: signedInCount(u.name),                                                    // computers signed in as them
            online: [...remoteInfo.values()].filter(r => r.user && sameName(r.user, u.name)).length   // remotes open right now
          }))
        });
      }
      if (req.method === 'POST') {
        touch(who);
        let body = {};
        try { body = JSON.parse((await readBody(req)).toString() || '{}'); } catch (_) {}
        const op = String(body.op || '');
        if ((op === 'add' || op === 'pin') && !String(body.pin || '').trim()) body.pin = makePin();   // left blank: make one up
        const out = changeUsers(op, body, whoName(who) || ipOf(req));
        if (out.ok && (op === 'add' || op === 'pin')) out.pin = String(body.pin).trim();
        return send(res, out.ok ? 200 : 400, out);
      }
    }

    // --- problem reports ---
    if (p === '/report' && req.method === 'GET') return send(res, 200, reports.info());
    if (p === '/report' && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await readBody(req, 12e6)).toString() || '{}'); }
      catch (_) { return send(res, 400, { error: 'Report was too big or unreadable' }); }
      touch(who);
      body.signedInAs = whoName(who) ? `${whoName(who)} (${LEVEL_NAMES[who.level]})` : (who.open ? 'open access' : '');
      return send(res, 200, await reports.submit(body, req));
    }

    // --- generic relay: /pp/v1/... -> ProPresenter /v1/... ---
    // Playlists are never changed from the remote: ProPresenter's API resets song arrangements on save.
    if (p.startsWith('/pp/v1/playlist') && req.method !== 'GET') {
      return send(res, 403, { error: 'Playlists are edited in ProPresenter, not from the remote' });
    }
    if (p.startsWith('/pp/')) {
      const keep = url.search.slice(1).split('&').filter(x => x && !/^(t|pin)=/.test(x));   // sign-in stays here
      const target = p.slice(3) + (keep.length ? '?' + keep.join('&') : '');
      const need = needLevel(req.method, target);
      if (!allowed(need)) {
        logLine(`  ${new Date().toLocaleTimeString()}  ${whoName(who) || ipOf(req)} (${LEVEL_NAMES[who.level]}) isn't allowed: ${req.method} ${target}`);
        return refuse();
      }
      if (need !== 'viewer') touch(who);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;
      let upstream;
      try {
        upstream = await pro(target, { method: req.method, body: body && body.length ? body : undefined, timeout: 8000 });
      } catch (e) {
        return send(res, 502, { error: `ProPresenter unreachable at ${config.proHost}:${config.proPort}` });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      // log every command (not routine reads) so problems can be traced from the Terminal window
      const isCommand = /trigger|\/clear|\/next|\/previous|\/operation|\/(start|stop|reset)$|\/stage\/screen\/[^/]+\/layout\/[^/?]+|\/capture\/(start|stop)|\/transport\/[^/]+\/(play|pause|skip_forward|skip_backward|go_to_end)/.test(target) || (req.method === 'PUT' && /\/transport\//.test(target)) || req.method !== 'GET';
      if (isCommand || (!upstream.ok && !target.includes('/thumbnail'))) {   // commands, and anything that failed
        const t = new Date().toLocaleTimeString();
        const note = upstream.ok ? 'OK' : `FAILED ${buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 100)}`;
        const by = whoName(who) ? `${whoName(who)}  ` : '';
        logLine(`  ${t}  ${by}${req.method} ${target}  ->  ${upstream.status} ${note}`);
      }
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': target.includes('/thumbnail') ? 'max-age=30' : 'no-store'
      });
      res.end(buf);
      // nudge everyone after a command so the screen updates instantly
      if (target.includes('trigger') || target.includes('/clear') || target.includes('/transport/') || req.method !== 'GET') setTimeout(() => poll(true), 80);
      return;
    }

    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

// Open the remote in the default browser on start.
function openBrowser(url) {
  if (!(config.autoOpenBrowser || process.env.OPEN_BROWSER) || process.env.NO_BROWSER) return;
  const cmd = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch (_) {}
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------- who is connected ----------
// One entry per open remote (a browser tab or window showing the remote).
const remoteInfo = new Map();
function describeRemote(req) {
  let ip = String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
  const local = ip === '127.0.0.1' || ip === '::1';
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const system = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const place = local ? 'this computer' : ip;
  return { ip: local ? 'this computer' : ip, since: new Date(), label: `${place} (${browser}${system ? ' on ' + system : ''})` };
}
function remotesSummary() {
  const n = remoteInfo.size;
  const computers = new Set([...remoteInfo.values()].map(r => r.ip)).size;
  if (!n) return 'No remotes open.';
  return `Remotes open: ${n}` + (computers !== n ? ` on ${computers} computer${computers === 1 ? '' : 's'}` : '') + '.';
}
// Each open remote checks in every 15 s. One that goes quiet (computer asleep, Wi-Fi dropped, cable pulled)
// is closed after 45 s, or 3 minutes if its tab was in the background (browsers slow down background tabs).
const ALIVE_LIMIT = 45000, ALIVE_LIMIT_HIDDEN = 180000;
setInterval(() => {
  const now = Date.now();
  for (const r of remoteInfo.values()) {
    if (!r.cid || r.reason) continue;
    if (now - r.lastSeen > (r.hidden ? ALIVE_LIMIT_HIDDEN : ALIVE_LIMIT)) {
      r.reason = 'stopped responding';
      try { r.res.destroy(); } catch (_) {}
    }
  }
}, 5000).unref();

function printRemotes() {
  console.log(`\n  ${remotesSummary()}`);
  for (const r of remoteInfo.values()) {
    console.log(`     ${r.label}, open since ${r.since.toLocaleTimeString()}${r.hidden ? ' (in the background)' : ''}`);
  }
  console.log('');
}

// ---------- people, from this window ----------
// PINs are printed with console.log only, so they never land in the log that goes with problem reports.
function makePin(digits = 6) {
  for (;;) {
    const pin = String(require('crypto').randomInt(10 ** (digits - 1), 10 ** digits));
    if (!config.users.some(u => u.pin === pin)) return pin;
  }
}
function printAccess() {
  if (!config.users.length) {
    console.log('  Access: open. Anyone on this network can use the remote, no PIN needed.');
    if (commandsOn) console.log('  To require PINs, add yourself as an Admin, e.g.  add Gavin admin');
    return;
  }
  const starter = config.users.find(u => u.starterPin);
  if (starter) {
    console.log(`  ${starter.name} PIN: ${starter.pin}   (type it on a remote to sign in)`);
    if (commandsOn) console.log(`  This PIN was made up for you. Change it with  pin ${starter.name} 1234 , add your team with  add Sarah operator ,\n  or type  help  for everything else.`);
  } else {
    console.log(`  Access: each person signs in with their own PIN (${config.users.length} ${config.users.length === 1 ? 'person' : 'people'}).` +
      (commandsOn ? ' Type  users  to see who, and their PINs.' : ''));
  }
  console.log('  This computer never needs a PIN.');
}
function printUsers() {
  if (!config.users.length) { console.log('\n  Nobody added: anyone on this network can use the remote.\n  Add someone with  add Sarah operator\n'); return; }
  const w = Math.max(6, ...config.users.map(u => u.name.length)) + 2;
  console.log(`\n  People (${config.users.length}):`);
  for (const u of config.users) {
    const last = lastUsed(u.name);
    console.log(`     ${u.name.padEnd(w)}${LEVEL_NAMES[u.level].padEnd(13)}PIN ${u.pin.padEnd(10)}${last ? 'last used ' + new Date(last).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not signed in'}`);
  }
  console.log('  Levels: viewer (watch only) · slides (slides + Clear) · operator (runs the service) · admin (everything)\n');
}
const commandsOn = !!process.stdin.isTTY;
if (commandsOn) {
  const rl = require('readline').createInterface({ input: process.stdin, terminal: false });
  const say = out => console.log(out.ok ? '' : `  ${out.error}`);
  rl.on('line', line => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const cmd = words[0].toLowerCase(), rest = words.slice(1);
    const isLevel = w => LEVELS.includes(String(w).toLowerCase());
    const isPin = w => /^\d+$/.test(String(w));
    if (cmd === 'users' || cmd === 'people' || (cmd === 'pin' && !rest.length)) return printUsers();
    if (cmd === 'add') {
      // add <name> [pin] <level>
      if (rest.length < 2 || !isLevel(rest[rest.length - 1])) return console.log('  Type  add Sarah operator  (makes a PIN for her) or  add Sarah 2580 operator');
      const level = rest.pop();
      const pin = rest.length > 1 && isPin(rest[rest.length - 1]) ? rest.pop() : makePin();
      const out = changeUsers('add', { name: rest.join(' '), pin, level }, '');
      if (!out.ok) return say(out);
      return console.log(`  ${findUser(rest.join(' ')).name}'s PIN: ${pin}\n`);
    }
    if (cmd === 'remove') {
      if (!rest.length) return console.log('  Type  remove Sarah');
      return say(changeUsers('remove', { name: rest.join(' ') }, ''));
    }
    if (cmd === 'pin') {
      // pin <name> <new pin>
      if (rest.length < 2 || !isPin(rest[rest.length - 1])) return console.log('  Type  pin Sarah 2580  to give Sarah a new PIN.  users  shows everyone\'s PIN.');
      const pin = rest.pop(), name = rest.join(' ');
      const out = changeUsers('pin', { name, pin }, '');
      if (!out.ok) return say(out);
      return console.log(`  ${findUser(name).name}'s PIN: ${pin}  (they're signed out and sign in with the new one)\n`);
    }
    if (cmd === 'level') {
      if (rest.length < 2 || !isLevel(rest[rest.length - 1])) return console.log('  Type  level Sarah viewer   (viewer, slides, operator or admin)');
      const level = rest.pop();
      return say(changeUsers('level', { name: rest.join(' '), level }, ''));
    }
    if (cmd === 'signout') {
      if (!rest.length) return console.log('  Type  signout Sarah  (or  signout everyone)');
      if (/^(everyone|all)$/i.test(rest.join(' '))) {
        for (const u of config.users) signOut(u.name);
        return logLine(`  ${new Date().toLocaleTimeString()}  Signed everyone out`);
      }
      return say(changeUsers('signout', { name: rest.join(' ') }, ''));
    }
    if (cmd === 'remotes' || cmd === 'connections' || cmd === 'who') return printRemotes();
    if (cmd === 'help' || cmd === '?') {
      return console.log('\n  Commands (type, then press Enter):\n' +
        '     users                     everyone who can use the remote, their level and PIN\n' +
        '     add Sarah operator        add Sarah and make up a PIN for her\n' +
        '     add Sarah 2580 operator   add Sarah with PIN 2580\n' +
        '     pin Sarah 2580            give Sarah a new PIN\n' +
        '     level Sarah viewer        change Sarah\'s level\n' +
        '     signout Sarah             sign Sarah out everywhere   (signout everyone  for all)\n' +
        '     remove Sarah              take Sarah\'s access away\n' +
        '     remotes                   show how many remotes are open, and who / where\n' +
        '     who                       same as remotes\n' +
        '     connections               same as remotes\n' +
        '     help                      show this list\n' +
        '  Levels: viewer (watch only) · slides (slides + Clear) · operator (runs the service) · admin (everything)\n' +
        `  A remote not used for ${Math.round(SIGN_OUT_AFTER / 864e5)} days asks for the PIN again. With nobody added, no PIN is needed.\n` +
        '  Press Ctrl+C to stop the remote.\n');
    }
    console.log(`  Unknown command "${cmd}". Type  help  for the list.`);
  });
  rl.on('SIGINT', () => process.exit(0));   // Ctrl+C still stops the remote
}

server.listen(config.remotePort, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log(DEMO ? '\n  Pro Remote DEMO is running (pretend ProPresenter with sample songs, nothing real is controlled)\n'
                   : `\n  Pro Remote ${APP_VERSION} is running\n`);
  console.log(`  Talking to ProPresenter at ${config.proHost}:${config.proPort}`);
  console.log('  Open the remote from any computer on this network:');
  for (const a of addrs) console.log(`     http://${a}:${config.remotePort}`);
  console.log(`     http://localhost:${config.remotePort}  (this computer)`);
  console.log('');
  if (config.pinMoved) {
    console.log('  The old shared PIN is now a person called Admin (same PIN). Give each person their own with  add Sarah operator');
    delete config.pinMoved; saveConfig();
  }
  printAccess();
  console.log(commandsOn ? '\n  Type  help  for commands.  Press Ctrl+C to stop.\n' : '\n  Press Ctrl+C to stop.\n');
  pollLoop();
  openBrowser(`http://localhost:${config.remotePort}`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${config.remotePort} is already in use. Set REMOTE_PORT or change remotePort in config.json.`);
  } else console.error(e);
  process.exit(1);
});
