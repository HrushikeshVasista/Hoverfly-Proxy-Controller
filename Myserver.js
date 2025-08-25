// @ts-check
/**
 * @file        Myserver.js
 * @description Proxy controller - proxy for a proxy (Hoverfly)
 * @author      Rushi Vasista
 * @created     2025-07-03
 * @version     1.0.0
 */
const http = require('http');
//const https = require('https');
const { URL } = require('url');

// @ts-check
//const httpProxy = require('http-proxy');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Create a proxy controller to a proxy (i.e. Hoverfly)
const server = http.createServer((req, res) => {
  const pathname = req.url;

  // Admin API passthrough
  if (pathname.startsWith('/admin')) {

    const options = {
      hostname: 'localhost',
      port: 8888,
      path: pathname.replace(/^\/admin/, '') || '/',
      method: req.method,
      headers: req.headers
    };

    // and simply pipe any admin response from HOverfly to the client
    const proxyReq = http.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    // simply pipe any admin requests from client to the proxy
    req.pipe(proxyReq);
    proxyReq.on('error', err => {
      res.writeHead(502);
      res.end(`Admin proxy error: ${err.message}`);
    });
    return;
  }

  // Chat completions proxy endpoint
  if (pathname === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      let targetUrl;
      try {
        //proxy controller gets the intended target endpoint from client
        const parsedBody = JSON.parse(body); // -d {url: <target>}
        targetUrl = parsedBody.url;
        if (!targetUrl) throw new Error('Missing "url"');
      } catch (err) {
        res.writeHead(400);
        return res.end('Invalid JSON body or missing "url" field');
      }

      const urlObj = new URL(targetUrl);
      const protocol = urlObj.protocol;
      const isHttps = protocol.includes('https');

      function getProxyDetails() {
        const proxy = 'http://hoverfly:8500'; // for debugging: localhost:8500        
        return isHttps
          ? { agent: new HttpsProxyAgent(proxy), client: require('https') }
          : { agent: new HttpProxyAgent(proxy), client: require('http') };
      }

      const { agent, client } = getProxyDetails();

      const proxyReq = client.request(new URL(targetUrl),
        {
          method: 'GET',
          agent          
        }, proxyRes => {
          let simResponse = '';
          proxyRes.on('data', chunk => {
            simResponse += chunk; console.log('Got a chunk!', process.pid)});
          proxyRes.on('end', () => {
            console.log('Last chunk received', process.pid);
            const chunks = simResponse.match(/.{1,4}/g) || [];
            res.writeHead(200, {
              'Content-Type': 'text/plain',
              'Transfer-Encoding': 'chunked',
              'Cache-Control': 'no-cache'
            });
            let i = 0;
            const interval = setInterval(() => {
              if (i < chunks.length) {
                res.write(chunks[i]);
                i++;
              } else {
                clearInterval(interval);
                res.end();
              }
            }, 300);
          });
          proxyRes.on('error', () => {
            console.log('Something errored when respsonding');
          });
        });

        proxyReq.end();
    });


    req.on('error', err => {
      res.writeHead(502);
      res.end(`Fetch error: ${err.message}`);
    });

    return;
  }

  // Fallback for unmatched routes
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(3000, () => {
  console.log('Proxy running at http://localhost:3000');
});