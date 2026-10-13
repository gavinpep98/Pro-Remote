#!/usr/bin/env node
// Pro Remote · Copyright (C) 2026 Gavin Peppers · Contributors: Crossroads Community Church, Athens, GA
// SPDX-License-Identifier: GPL-3.0-or-later  (see LICENSE.txt and COPYRIGHT.txt)
/*
 * Pro Remote DEMO: runs a pretend ProPresenter (sample songs, playlists, props, Looks, media)
 * and the real remote pointed at it. Nothing real is controlled. Uses its own settings file.
 * Run:  node demo/start-demo.js   (or double-click "Start Demo")
 */
const http = require('http');
const path = require('path');
const { createFakePro } = require('./fake-propresenter.js');

const handle = createFakePro();
const FAKE_PORT = Number(process.env.DEMO_PRO_PORT || 51025);
const REMOTE_PORT = Number(process.env.REMOTE_PORT || 8090);   // different from the real remote's 4316

const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    // Instant updates, like ProPresenter's /v1/status/updates: keep the line open and send what changes
    if (req.method === 'POST' && req.url === '/v1/status/updates') {
      let keys = [];
      try { keys = JSON.parse(body); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const last = {};
      const tick = () => {
        for (const k of keys) {
          const out = handle('GET', '/v1/' + k, '');
          const text = out.status === 200 ? out.body : 'null';
          if (text === last[k]) continue;
          last[k] = text;
          let data = null; try { data = JSON.parse(text); } catch (_) {}
          res.write(JSON.stringify({ url: k, data }) + '\r\n\r\n');
        }
      };
      tick();
      const t = setInterval(tick, 150);
      res.on('close', () => clearInterval(t));   // (req 'close' fires as soon as the request body is read)
      return;
    }
    const out = handle(req.method, req.url, body);
    res.writeHead(out.status, out.type ? { 'Content-Type': out.type } : {});
    res.end(out.status === 204 ? undefined : out.body);
  });
});

fake.on('error', e => {
  console.error(e.code === 'EADDRINUSE'
    ? `Port ${FAKE_PORT} is busy. Close the other demo window, or set DEMO_PRO_PORT to another number.`
    : e.message);
  process.exit(1);
});

fake.listen(FAKE_PORT, '127.0.0.1', () => {
  Object.assign(process.env, {
    PRO_REMOTE_DEMO: '1',
    PRO_HOST: '127.0.0.1',
    PRO_PORT: String(FAKE_PORT),
    REMOTE_PORT: String(REMOTE_PORT),
    REMOTE_PIN: '',
    PRO_REMOTE_CONFIG: path.join(__dirname, 'demo-config.json'),
    OPEN_BROWSER: '1'
  });
  require('../server.js');
});
