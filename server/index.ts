import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.ts'

const env = process.env
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d)

const app = createApp({
  baseUrl: env.LOST112_API_BASE ?? 'https://api.koreaconnect.kr/01/1/2603101713597416530PDP/SAFETY/1320000',
  apiKey: env.LOST112_API_KEY ?? '',
  timeoutMs: num(env.LOST112_TIMEOUT_MS, 15_000),
  pageSize: num(env.LOST112_PAGE_SIZE, 1000),
  maxItemsPerSource: num(env.LOST112_MAX_ITEMS_PER_SOURCE, 20_000),
  concurrency: num(env.LOST112_CONCURRENCY, 4),
  cacheTtlMs: num(env.LOST112_CACHE_TTL_SECONDS, 600) * 1000,
  maxRangeDays: num(env.LOST112_MAX_RANGE_DAYS, 92),
})

// 프로덕션: 빌드된 프론트엔드(dist/) 서빙 + SPA fallback
const distDir = resolve(env.STATIC_DIR ?? 'dist')
if (existsSync(resolve(distDir, 'index.html'))) {
  const indexHtml = readFileSync(resolve(distDir, 'index.html'), 'utf8')
  app.use('/assets/*', serveStatic({ root: distDir, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }))
  app.use('*', serveStatic({ root: distDir }))
  app.get('*', (c) => c.html(indexHtml))
}

const port = num(env.PORT, 8787)
serve({ fetch: app.fetch, port, hostname: env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`back2u server listening on http://${info.address}:${info.port}`)
  if (!env.LOST112_API_KEY) console.warn('[warn] LOST112_API_KEY is not set — /api/lost-items will return config_error')
})
