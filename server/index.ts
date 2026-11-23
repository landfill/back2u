import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { app } from './runtime.js'

// 프로덕션: 빌드된 프론트엔드(dist/) 서빙 + SPA fallback
const distDir = resolve(process.env.STATIC_DIR ?? 'dist')
if (existsSync(resolve(distDir, 'index.html'))) {
  const indexHtml = readFileSync(resolve(distDir, 'index.html'), 'utf8')
  app.use('/assets/*', serveStatic({ root: distDir, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }))
  app.use('*', serveStatic({ root: distDir }))
  app.get('*', (c) => c.html(indexHtml))
}

const configuredPort = Number(process.env.PORT || 8787)
const port = Number.isFinite(configuredPort) ? configuredPort : 8787
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`back2u server listening on http://${info.address}:${info.port}`)
  if (!process.env.LOST112_API_KEY) console.warn('[warn] LOST112_API_KEY is not set — /api/lost-items will return config_error')
})
