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
const APP_VERSION = '1.1';   // keep in step with PAGE_VERSION in public/index.html
// Where settings and saved reports live: next to this file, or (for the Mac app) in the user's
// Application Support folder, passed in as PRO_REMOTE_DATA
const DATA_DIR = process.env.PRO_REMOTE_DATA || __dirname;
const CONFIG_FILE = process.env.PRO_REMOTE_CONFIG || path.join(DATA_DIR, 'config.json');
const DEMO = !!process.env.PRO_REMOTE_DEMO;
const DEFAULTS = {
  proHost: '127.0.0.1', // where ProPresenter is running
  proPort: 1025,        // ProPresenter > Settings > Network > Port
  remotePort: 4316,     // port this remote is served on (open http://<this computer>:4316)
  pin: '',              // optional PIN required to use the remote ('' = no PIN)
  autoOpenBrowser: false // set true in config.json to open the remote in this computer's browser on start
};

let config = { ...DEFAULTS };
try {
  config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
} catch (_) { /* first run: use defaults */ }
delete config.openBrowser;
// The remote used to run on 8080 (a port lots of other programs use too); move older setups to 4316
if (config.remotePort === 8080) { config.remotePort = 4316; try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (_) {} }
if (process.env.PRO_HOST) config.proHost = process.env.PRO_HOST;
if (process.env.PRO_PORT) config.proPort = Number(process.env.PRO_PORT);
if (process.env.REMOTE_PORT) config.remotePort = Number(process.env.REMOTE_PORT);
if (process.env.REMOTE_PIN !== undefined) config.pin = process.env.REMOTE_PIN;

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {
    console.error('Could not save config.json:', e.message);
  }
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
        sentFrom: `${req.socket.remoteAddress || '?'}`
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

function authorized(req, url) {
  if (!config.pin) return true;
  const given = req.headers['x-remote-pin'] || url.searchParams.get('pin');
  return given === config.pin;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // --- PIN check endpoint (always reachable) ---
    if (p === '/auth') {
      return send(res, authorized(req, url) ? 200 : 401, { pinRequired: !!config.pin, ok: authorized(req, url) });
    }

    // --- static files ---
    if (!p.startsWith('/pp/') && !['/events', '/config', '/report'].includes(p)) {
      const file = p === '/' ? 'index.html' : p.slice(1);
      const full = path.join(__dirname, 'public', path.normalize(file));
      if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Forbidden', 'text/plain');
      return fs.readFile(full, (err, data) => {
        if (err) return send(res, 404, 'Not found', 'text/plain');
        send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
      });
    }

    if (!authorized(req, url)) return send(res, 401, { error: 'PIN required' });

    // --- live updates ---
    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      res.write(`data: ${JSON.stringify(publicState())}\n\n`);
      const ka = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }

    // --- settings ---
    if (p === '/config') {
      if (req.method === 'GET') {
        return send(res, 200, { proHost: config.proHost, proPort: config.proPort, pinSet: !!config.pin });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (body.proHost) config.proHost = String(body.proHost).trim();
        if (body.proPort) config.proPort = Number(body.proPort);
        if (typeof body.pin === 'string') config.pin = body.pin.trim();
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

    // --- problem reports ---
    if (p === '/report' && req.method === 'GET') return send(res, 200, reports.info());
    if (p === '/report' && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await readBody(req, 12e6)).toString() || '{}'); }
      catch (_) { return send(res, 400, { error: 'Report was too big or unreadable' }); }
      return send(res, 200, await reports.submit(body, req));
    }

    // --- generic relay: /pp/v1/... -> ProPresenter /v1/... ---
    // Playlists are never changed from the remote: ProPresenter's API resets song arrangements on save.
    if (p.startsWith('/pp/v1/playlist') && req.method !== 'GET') {
      return send(res, 403, { error: 'Playlists are edited in ProPresenter, not from the remote' });
    }
    if (p.startsWith('/pp/')) {
      const target = p.slice(3) + url.search.replace(/([?&])pin=[^&]*&?/, '$1').replace(/[?&]$/, '');
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
        logLine(`  ${t}  ${req.method} ${target}  ->  ${upstream.status} ${note}`);
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

server.listen(config.remotePort, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log(DEMO ? '\n  Pro Remote DEMO is running (pretend ProPresenter with sample songs, nothing real is controlled)\n'
                   : `\n  Pro Remote ${APP_VERSION} is running\n`);
  console.log(`  Talking to ProPresenter at ${config.proHost}:${config.proPort}`);
  console.log('  Open the remote from any computer on this network:');
  for (const a of addrs) console.log(`     http://${a}:${config.remotePort}`);
  console.log(`     http://localhost:${config.remotePort}  (this computer)`);
  if (config.pin) console.log('  PIN protection is ON');
  console.log('\n  Press Ctrl+C to stop.\n');
  pollLoop();
  openBrowser(`http://localhost:${config.remotePort}`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${config.remotePort} is already in use. Set REMOTE_PORT or change remotePort in config.json.`);
  } else console.error(e);
  process.exit(1);
});
