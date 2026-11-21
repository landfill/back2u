import { Hono } from 'hono'
import { REGIONS } from '../shared/regions.ts'
import { createSearchService, type SearchConfig } from './search.ts'

const toInt = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

export function createApp(cfg: SearchConfig) {
  const service = createSearchService(cfg)
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true, apiKeyConfigured: Boolean(cfg.apiKey) }))

  app.get('/api/meta', (c) =>
    c.json({
      regions: REGIONS,
      maxRangeDays: cfg.maxRangeDays,
      maxItemsPerSource: cfg.maxItemsPerSource,
      apiKeyConfigured: Boolean(cfg.apiKey),
    }),
  )

  app.get('/api/lost-items', async (c) => {
    const q = c.req.query()
    const result = await service.search({
      START_YMD: (q.START_YMD ?? '').replace(/\D/g, ''),
      END_YMD: (q.END_YMD ?? '').replace(/\D/g, ''),
      region: q.region || '지역전체',
      institution: q.institution || '기관전체',
      category: q.category || '분류전체',
      keyword: (q.keyword ?? '').slice(0, 50),
      pageNo: toInt(q.pageNo, 1, 1, 10_000),
      numOfRows: toInt(q.numOfRows, 20, 1, 100),
    })
    const { httpStatus, ...body } = result
    c.header('Cache-Control', 'no-store')
    return c.json(body, httpStatus as 200)
  })

  app.all('/api/*', (c) => c.json({ status: 'not_found' }, 404))
  return app
}
