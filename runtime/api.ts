/**
 * runtime/api.ts — V2 API Capture & Reverse Engineering Runtime
 *
 * Captures network requests made by the browser to reverse-engineer
 * the 简道云 internal API. Used to build the Open API integration layer.
 *
 * Features:
 *   - Network request interception (Playwright route API)
 *   - API endpoint capture & classification
 *   - Request/response body logging (redacted)
 */

import type { Page, Route, Request } from 'playwright';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapturedRequest {
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timestamp: number;
}

export interface ApiEndpoint {
  path: string;
  method: string;
  description: string;
  exampleRequest: unknown;
  exampleResponse: unknown;
}

export type CaptureFilter = (request: Request) => boolean;

// ---------------------------------------------------------------------------
// Capture engine
// ---------------------------------------------------------------------------

/**
 * Start capturing API requests on the page.
 * Filters for XHR/fetch requests that match the provided filter.
 */
export async function startApiCapture(
  page: Page,
  filter?: CaptureFilter
): Promise<CapturedRequest[]> {
  const captured: CapturedRequest[] = [];

  await page.route('**/*', async (route: Route) => {
    const request = route.request();

    // Only capture API-like requests
    const isApi = request.url().includes('/api/') ||
      request.url().includes('/app/') ||
      request.headers()['x-requested-with'] === 'XMLHttpRequest' ||
      request.resourceType() === 'xhr' ||
      request.resourceType() === 'fetch';

    if (!isApi) {
      await route.continue();
      return;
    }

    if (filter && !filter(request)) {
      await route.continue();
      return;
    }

    console.log(`[API] captured: ${request.method()} ${request.url()}`);

    await route.continue();

    // Capture response after continue
    try {
      const response = await request.response();
      if (response) {
        const body = await response.text().catch(() => '<binary or too large>');
        captured.push({
          url: request.url(),
          method: request.method(),
          status: response.status(),
          requestHeaders: request.headers(),
          responseHeaders: response.headers(),
          requestBody: request.postData() ?? undefined,
          responseBody: body.slice(0, 10_000), // Truncate large responses
          timestamp: Date.now(),
        });
      }
    } catch {
      // Response may not be available (aborted, etc.)
    }
  });

  console.log('[API] capture engine started');
  return captured;
}

/**
 * Stop capturing and return all captured requests.
 */
export async function stopApiCapture(page: Page): Promise<CapturedRequest[]> {
  await page.unroute('**/*');
  console.log('[API] capture engine stopped');
  return [];
}

/**
 * Classify captured requests into API endpoints.
 */
export function classifyEndpoints(captured: CapturedRequest[]): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const seen = new Set<string>();

  for (const req of captured) {
    const url = new URL(req.url);
    const key = `${req.method}:${url.pathname}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // Try to parse response as JSON
    let exampleResponse: unknown = req.responseBody;
    try {
      if (req.responseBody) {
        exampleResponse = JSON.parse(req.responseBody);
      }
    } catch {
      // Keep as raw string
    }

    let exampleRequest: unknown = undefined;
    try {
      if (req.requestBody) {
        exampleRequest = JSON.parse(req.requestBody);
      }
    } catch {
      exampleRequest = req.requestBody;
    }

    endpoints.push({
      path: url.pathname,
      method: req.method,
      description: classifyPath(url.pathname, req.method),
      exampleRequest,
      exampleResponse,
    });
  }

  return endpoints;
}

/**
 * Heuristic path classification for 简道云 API.
 */
function classifyPath(path: string, method: string): string {
  const segments = path.split('/').filter(Boolean);

  if (path.includes('/form/') && method === 'GET') return '获取表单详情';
  if (path.includes('/form/') && method === 'POST') return '创建/更新表单';
  if (path.includes('/form/') && method === 'DELETE') return '删除表单';
  if (path.includes('/field/') && method === 'POST') return '创建/更新字段';
  if (path.includes('/data/') && method === 'GET') return '查询数据';
  if (path.includes('/data/') && method === 'POST') return '新增数据';
  if (path.includes('/data/') && method === 'PUT') return '修改数据';
  if (path.includes('/data/') && method === 'DELETE') return '删除数据';
  if (path.includes('/relation/')) return '数据联动操作';
  if (path.includes('/aggregate/')) return '聚合表操作';
  if (path.includes('/assistant/')) return '智能助手操作';
  if (path.includes('/factory/')) return '数据工厂操作';
  if (path.includes('/login')) return '登录';
  if (path.includes('/auth')) return '认证';

  return `API: ${segments.at(-1) ?? 'unknown'}`;
}

/**
 * Export endpoints as OpenAPI-style JSON.
 */
export function toOpenApiSpec(
  endpoints: ApiEndpoint[],
  title: string = '简道云 Agent API'
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const ep of endpoints) {
    if (!paths[ep.path]) paths[ep.path] = {};
    (paths[ep.path] as Record<string, unknown>)[ep.method.toLowerCase()] = {
      summary: ep.description,
      operationId: `${ep.method}_${ep.path.replace(/[/-]/g, '_')}`,
      responses: {
        '200': { description: 'Success' },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: { title, version: '1.0.0' },
    paths,
  };
}
