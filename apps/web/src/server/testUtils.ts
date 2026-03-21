import type { IncomingMessage, ServerResponse } from 'node:http';

type TestRequestOptions = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  encrypted?: boolean;
};

type HeaderMap = Record<string, string | string[]>;

export type TestResponse = ServerResponse<IncomingMessage> & {
  bodyText: string;
  headers: HeaderMap;
};

export function createTestRequest(options: TestRequestOptions = {}): IncomingMessage {
  const bodyText = options.body == null
    ? ''
    : typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  const chunks = bodyText ? [Buffer.from(bodyText)] : [];

  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? {},
    socket: { encrypted: options.encrypted ?? false },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  } as unknown as IncomingMessage;
}

export function createTestResponse(): TestResponse {
  const headers: HeaderMap = {};
  const response: {
    statusCode: number;
    headersSent: boolean;
    writableEnded: boolean;
    bodyText: string;
    headers: HeaderMap;
    setHeader: (name: string, value: string | string[]) => unknown;
    getHeader: (name: string) => unknown;
    end: (chunk?: string | Buffer) => unknown;
  } = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: string | Buffer) {
      if (chunk != null) {
        this.bodyText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      }
      this.writableEnded = true;
      this.headersSent = true;
      return this;
    },
    bodyText: '',
    headers
  };

  return response as unknown as TestResponse;
}
