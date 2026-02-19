export type Chief2AiProvider = {
  complete: (input: {
    system: string;
    prompt: string;
  }) => Promise<string | null>;
};

export function createOpenRouterProvider(): Chief2AiProvider {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const model = String(process.env.OPENROUTER_MODEL || 'openrouter/auto').trim() || 'openrouter/auto';

  return {
    async complete(input): Promise<string | null> {
      if (!apiKey) {
        return null;
      }
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.prompt }
            ],
            temperature: 0.2,
            max_tokens: 260
          })
        });
        if (!response.ok) {
          return null;
        }
        const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
        const text = String(payload?.choices?.[0]?.message?.content || '').trim();
        return text || null;
      } catch {
        return null;
      }
    }
  };
}
