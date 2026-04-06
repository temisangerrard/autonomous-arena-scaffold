import { readJsonBody, sendJson } from '../../lib/http.js';
import { generateContent, DEFAULT_PRODUCT_CONTEXT, type GenerateContentRequest, type ContentTone, type TargetAudience } from '../../content-studio/generator.js';
import type { RouteHandler } from '../types.js';

const VALID_TONES = new Set<ContentTone>(['hype', 'educational', 'challenge', 'behind_the_scenes', 'curiosity']);
const VALID_AUDIENCES = new Set<TargetAudience>(['crypto_native', 'gamer', 'defi_user', 'general']);
const VALID_CONTENT_TYPES = new Set([
  'tiktok_hook',
  'tiktok_script',
  'caption',
  'twitter_thread',
  'cta_variations',
  'video_concept'
]);

export const handleContentStudioRoutes: RouteHandler = async (req, res, requestUrl) => {
  const { pathname } = requestUrl;

  if (pathname === '/api/content-studio/generate' && req.method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(req);

    if (!body) {
      sendJson(res, { ok: false, error: 'Invalid request body' }, 400);
      return true;
    }

    const tone = typeof body.tone === 'string' && VALID_TONES.has(body.tone as ContentTone)
      ? (body.tone as ContentTone)
      : 'hype';

    const audience = typeof body.audience === 'string' && VALID_AUDIENCES.has(body.audience as TargetAudience)
      ? (body.audience as TargetAudience)
      : 'general';

    const rawTypes = Array.isArray(body.contentTypes) ? body.contentTypes : [];
    const contentTypes = rawTypes.filter((t): t is string =>
      typeof t === 'string' && VALID_CONTENT_TYPES.has(t)
    );

    if (contentTypes.length === 0) {
      sendJson(res, { ok: false, error: 'Provide at least one valid content type' }, 400);
      return true;
    }

    const productContext = typeof body.productContext === 'string' && body.productContext.trim().length > 20
      ? body.productContext.trim()
      : undefined;

    const request: GenerateContentRequest = { productContext, tone, audience, contentTypes };
    const result = await generateContent(request);

    sendJson(res, result, result.ok ? 200 : 500);
    return true;
  }

  if (pathname === '/api/content-studio/context' && req.method === 'GET') {
    sendJson(res, { context: DEFAULT_PRODUCT_CONTEXT });
    return true;
  }

  return false;
};
