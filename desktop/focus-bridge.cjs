const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');

const PORT = 42631;

function createFocusBridge(token, readFocus) {
  const expected = Buffer.from('Bearer ' + token);
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.host !== `127.0.0.1:${server.address().port}`
      || request.method !== 'GET' || request.url !== '/v1/focus') {
      response.writeHead(404).end();
      return;
    }
    const authorization = Buffer.from(request.headers.authorization || '');
    if (authorization.length !== expected.length || !timingSafeEqual(expected, authorization)) {
      response.writeHead(401).end();
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

module.exports = { createFocusBridge, PORT };
