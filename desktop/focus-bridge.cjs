const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');

const PORT = 42631;
const MAX_REPORT_BYTES = 16_384;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROFILE = /^[a-f0-9-]{36}$/;

// A Chrome profile reports only daily blocked-attempt totals per domain and the
// days it was running, so the desktop app can show coverage and trends.
function validReport(report) {
  if (!report || typeof report !== 'object' || !PROFILE.test(report.profileId)) return null;
  const name = typeof report.profileName === 'string' ? report.profileName.trim().slice(0, 60) : '';
  const attempts = report.attempts ?? {};
  const activeDays = report.activeDays ?? [];
  if (typeof attempts !== 'object' || Array.isArray(attempts) || Object.keys(attempts).length > 40) return null;
  if (!Array.isArray(activeDays) || activeDays.length > 40 || !activeDays.every((day) => DAY.test(day))) return null;
  const clean = {};
  for (const [day, counts] of Object.entries(attempts)) {
    if (!DAY.test(day) || !counts || typeof counts !== 'object' || Object.keys(counts).length > 30) return null;
    clean[day] = {};
    for (const [domain, count] of Object.entries(counts)) {
      if (!DOMAIN.test(domain) || !Number.isSafeInteger(count) || count < 0 || count > 100_000) return null;
      clean[day][domain] = count;
    }
  }
  return { profileId: report.profileId, profileName: name || 'Chrome profile', attempts: clean, activeDays: [...activeDays] };
}

function createFocusBridge(token, readFocus, onReport = () => {}) {
  const expected = Buffer.from('Bearer ' + token);
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const route = `${request.method} ${request.url}`;
    if (request.headers.host !== `127.0.0.1:${server.address().port}`
      || (route !== 'GET /v1/focus' && route !== 'POST /v1/report')) {
      response.writeHead(404).end();
      return;
    }
    const authorization = Buffer.from(request.headers.authorization || '');
    if (authorization.length !== expected.length || !timingSafeEqual(expected, authorization)) {
      response.writeHead(401).end();
      return;
    }
    if (route === 'POST /v1/report') {
      if (!String(request.headers['content-type']).startsWith('application/json')) {
        response.writeHead(415).end();
        return;
      }
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REPORT_BYTES) {
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (response.headersSent) return;
        let report;
        try {
          report = validReport(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          report = null;
        }
        if (!report) {
          response.writeHead(400).end();
          return;
        }
        onReport({ ...report, receivedAt: Date.now() });
        response.writeHead(204).end();
      });
      return;
    }
    const focus = readFocus();
    if (focus === undefined) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ focus: focus?.endAt > Date.now() ? focus : null }));
  });
  return server;
}

module.exports = { createFocusBridge, validReport, PORT };
