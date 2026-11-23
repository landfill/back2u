import { env } from 'node:process'
import { createApp } from './app.js'

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d)

export const app = createApp({
  baseUrl: env.LOST112_API_BASE ?? 'https://api.koreaconnect.kr/01/1/2603101713597416530PDP/SAFETY/1320000',
  apiKey: env.LOST112_API_KEY ?? '',
  timeoutMs: num(env.LOST112_TIMEOUT_MS, 15_000),
  pageSize: num(env.LOST112_PAGE_SIZE, 1000),
  maxItemsPerSource: num(env.LOST112_MAX_ITEMS_PER_SOURCE, 20_000),
  concurrency: num(env.LOST112_CONCURRENCY, 4),
  cacheTtlMs: num(env.LOST112_CACHE_TTL_SECONDS, 600) * 1000,
  maxRangeDays: num(env.LOST112_MAX_RANGE_DAYS, 92),
})
