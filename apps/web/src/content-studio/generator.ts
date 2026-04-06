import Anthropic from '@anthropic-ai/sdk';

const ARENA_PRODUCT_CONTEXT = `
Autonomous Arena is an AI-powered multiplayer betting game built on Base (Ethereum L2 blockchain).

Key features:
- Real-money crypto wagering games: Coinflip, Rock Paper Scissors, Dice Duel, Blackjack, and BTC Price Prediction
- Autonomous AI bots that play and earn for you 24/7 even when you're offline
- On-chain settlement — your funds are secured by smart contracts on Base mainnet
- Human-bot handoff: seamlessly switch between playing yourself and letting your bot roam
- Multiple game rooms in a shared 3D world where bots and humans compete together
- Real-time leaderboards, challenge systems, and live BTC price prediction rounds
- Fund your bot, walk away, and watch it grind games on your behalf
`.trim();

export type ContentTone = 'hype' | 'educational' | 'challenge' | 'behind_the_scenes' | 'curiosity';
export type TargetAudience = 'crypto_native' | 'gamer' | 'defi_user' | 'general';

export type ContentPiece = {
  type: string;
  title: string;
  content: string;
  hashtags: string[];
  platform: string;
  duration?: string;
};

export type GenerateContentRequest = {
  productContext?: string;
  tone: ContentTone;
  audience: TargetAudience;
  contentTypes: string[];
};

export type GenerateContentResult = {
  ok: boolean;
  pieces: ContentPiece[];
  error?: string;
};

const TONE_DESCRIPTIONS: Record<ContentTone, string> = {
  hype: 'Exciting, energetic, FOMO-inducing. Uses caps, exclamation marks sparingly but effectively. Makes the audience feel they are missing out on something huge.',
  educational: 'Clear, informative, builds trust. Explains the value prop simply. Uses "here\'s how it works" framing.',
  challenge: 'Provocative, dares the audience. "Bet you can\'t..." or "Try this..." style hooks that invite participation.',
  behind_the_scenes: 'Insider look, authentic, raw. Shows the real mechanics. "We never told anyone this..." framing.',
  curiosity: 'Mysterious opener, cliffhanger structure. "I did X and this happened..." or "Nobody talks about..." style.'
};

const AUDIENCE_DESCRIPTIONS: Record<TargetAudience, string> = {
  crypto_native: 'Crypto natives who understand Base, L2s, on-chain mechanics, DeFi. Use terms like gas, smart contracts, on-chain, wagering freely.',
  gamer: 'Gamers who love competition, leaderboards, and winning. Focus on skill, strategy, and beating opponents.',
  defi_user: 'DeFi users familiar with yield and passive income. Frame bots as "automated yield on games" and on-chain settlement as security.',
  general: 'General audience with no crypto knowledge. Avoid jargon, focus on fun, earning money while you sleep, and automated gameplay.'
};

const CONTENT_TYPE_PROMPTS: Record<string, string> = {
  tiktok_hook: 'A TikTok/Reels opening hook script (first 3 seconds that stop the scroll). Just the hook line — maximum 15 words. Make it a pattern interrupt.',
  tiktok_script: 'A full TikTok/Reels/YouTube Shorts script (30-60 seconds when spoken). Include [VISUAL CUE] notes. Structure: Hook → Problem/Intrigue → Demo/Proof → CTA.',
  caption: 'An Instagram/TikTok caption with strong opening line, 2-3 short paragraphs, and a CTA. Conversational tone.',
  twitter_thread: 'A Twitter/X thread (6-8 tweets). Tweet 1 is the hook. Tweets 2-6 build the story. Last tweet is CTA. Number each tweet.',
  cta_variations: 'Five different short call-to-action lines (1 sentence each) for use in bio, end screens, or captions.',
  video_concept: 'A video concept brief: title, core idea (2 sentences), visual treatment (3 bullet points), and why it will go viral (1 sentence).'
};

function buildSystemPrompt(): string {
  return `You are an elite short-form content strategist who has gone viral on TikTok, Instagram Reels, and YouTube Shorts for tech and crypto products. You understand hooks, pattern interrupts, and what makes content stop the scroll in 2024-2025.

Your content is concise, punchy, and platform-native. You never sound corporate or salesy. You write like a creator who genuinely uses and loves the product.

Return your response as valid JSON matching this exact structure:
{
  "pieces": [
    {
      "type": "string (content type key)",
      "title": "string (short display title)",
      "content": "string (the actual content)",
      "hashtags": ["string"],
      "platform": "string (TikTok / Instagram / Twitter / YouTube / Universal)",
      "duration": "string (optional, e.g. '30-45 sec')"
    }
  ]
}

Do not include any text outside the JSON object.`;
}

function buildUserPrompt(req: GenerateContentRequest): string {
  const productContext = req.productContext?.trim() || ARENA_PRODUCT_CONTEXT;
  const toneDesc = TONE_DESCRIPTIONS[req.tone];
  const audienceDesc = AUDIENCE_DESCRIPTIONS[req.audience];

  const contentTypeLines = req.contentTypes
    .map(ct => {
      const prompt = CONTENT_TYPE_PROMPTS[ct] ?? `A ${ct} content piece`;
      return `- ${ct}: ${prompt}`;
    })
    .join('\n');

  return `Generate viral short-form content for this product:

---
${productContext}
---

Tone: ${req.tone} — ${toneDesc}

Target audience: ${req.audience} — ${audienceDesc}

Generate the following content types:
${contentTypeLines}

For hashtags: use 5-8 highly relevant hashtags per piece mixing high-volume (#crypto, #AI) and niche (#BaseChain, #web3gaming) tags.

Make every piece feel authentic, native to its platform, and optimized for the algorithm.`;
}

export async function generateContent(req: GenerateContentRequest): Promise<GenerateContentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, pieces: [], error: 'ANTHROPIC_API_KEY not configured' };
  }

  const client = new Anthropic({ apiKey });

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(req) }]
    });

    const message = await stream.finalMessage();

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { ok: false, pieces: [], error: 'No text response from model' };
    }

    const raw = textBlock.text.trim();
    // Extract JSON if wrapped in markdown code fences
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? null;
    const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : raw;

    const parsed = JSON.parse(jsonStr) as { pieces: ContentPiece[] };
    return { ok: true, pieces: parsed.pieces ?? [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, pieces: [], error: message };
  }
}

export const DEFAULT_PRODUCT_CONTEXT = ARENA_PRODUCT_CONTEXT;
