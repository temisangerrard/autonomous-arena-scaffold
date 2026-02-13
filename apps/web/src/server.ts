import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHealthStatus } from './health.js';
import { availableWorldAliases, resolveWorldAssetPath } from './worldAssets.js';

const port = Number(process.env.PORT ?? 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirCandidates = [
  path.resolve(process.cwd(), 'apps/web/public'),
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, '../../../../../../apps/web/public')
];
const publicDir = publicDirCandidates.find((candidate) => existsSync(candidate)) ?? path.resolve(__dirname, '../public');

async function sendFile(res: import('node:http').ServerResponse, filePath: string, contentType: string): Promise<void> {
  try {
    const body = await readFile(filePath);
    res.setHeader('content-type', contentType);
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
  }
}

function htmlRouteToFile(pathname: string): string | null {
  if (pathname === '/') {
    return path.join(publicDir, 'index.html');
  }
  if (pathname === '/play') {
    return path.join(publicDir, 'play.html');
  }
  if (pathname === '/viewer') {
    return path.join(publicDir, 'viewer.html');
  }
  if (pathname === '/agents') {
    return path.join(publicDir, 'agents.html');
  }
  return null;
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/health') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(createHealthStatus()));
    return;
  }

  if (pathname === '/api/worlds') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ aliases: availableWorldAliases() }));
    return;
  }

  const worldMatch = pathname.match(/^\/assets\/world\/([a-zA-Z0-9_-]+)\.glb$/);
  if (worldMatch) {
    const alias = worldMatch[1];
    if (!alias) {
      res.statusCode = 400;
      res.end('Invalid world alias');
      return;
    }
    const worldPath = resolveWorldAssetPath(alias);
    if (!worldPath) {
      res.statusCode = 404;
      res.end('Unknown world alias');
      return;
    }
    await sendFile(res, worldPath, 'model/gltf-binary');
    return;
  }

  if (pathname.startsWith('/js/')) {
    const jsPath = path.join(publicDir, pathname);
    await sendFile(res, jsPath, 'text/javascript; charset=utf-8');
    return;
  }

  if (pathname === '/styles.css') {
    await sendFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
    return;
  }

  const htmlFile = htmlRouteToFile(pathname);
  if (htmlFile) {
    await sendFile(res, htmlFile, 'text/html; charset=utf-8');
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(port, () => {
  console.log(`web listening on :${port}`);
});
