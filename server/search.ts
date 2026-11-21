import type { LostItem, SearchResponse, Source, SourceStat } from '../shared/types.ts'
import { REGION_CODES } from '../shared/regions.ts'
import { fetchPage, normalize, type ClientConfig, UpstreamError } from './lost112.ts'

export type SearchConfig = ClientConfig & {
  /** 공식 API 1회 호출 시 받아올 건수 (numOfRows). */
  pageSize: number
  /** 출처별로 받아올 최대 건수. 초과분은 잘리고 complete=false 로 표시된다. */
  maxItemsPerSource: number
  /** 동시에 보낼 공식 API 요청 수. */
  concurrency: number
  /** 조회 결과 캐시 유지 시간(ms). */
  cacheTtlMs: number
  /** 한 번에 조회할 수 있는 최대 기간(일). */
  maxRangeDays: number
}

export type SearchInput = {
  START_YMD: string
  END_YMD: string
  region: string
  institution: string
  category: string
  keyword: string
  pageNo: number
  numOfRows: number
}

type SourceData = { items: LostItem[]; stat: SourceStat }
type CacheEntry = { at: number; promise: Promise<SourceData> }

const CATEGORY_TERMS: Record<string, string[]> = {
  '가방·지갑': ['가방', '지갑'],
  전자기기: ['전자', '휴대', '통신', '컴퓨터'],
  '의류·잡화': ['의류', '잡화', '신발', '모자'],
  '카드·서류': ['카드', '서류', '증명', '신분'],
  기타: ['기타'],
}

const ymdToDate = (v: string) => new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`)
const isYmd = (v: string) => /^\d{8}$/.test(v) && !Number.isNaN(ymdToDate(v).getTime()) && ymdToDate(v).toISOString().slice(0, 10).replaceAll('-', '') === v

async function mapLimit<T, R>(inputs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(inputs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (next < inputs.length) {
      const i = next++
      out[i] = await fn(inputs[i])
    }
  })
  await Promise.all(workers)
  return out
}

export function createSearchService(cfg: SearchConfig) {
  const cache = new Map<string, CacheEntry>()

  async function loadSource(source: Source, start: string, end: string, region: string): Promise<SourceData> {
    const base = { START_YMD: start, END_YMD: end, N_FD_LCT_CD: region || undefined, numOfRows: cfg.pageSize }
    const first = await fetchPage(cfg, source, { ...base, pageNo: 1 })
    const total = first.totalCount
    const limit = Math.min(total ?? first.items.length, cfg.maxItemsPerSource)
    const pages = Math.max(1, Math.ceil(limit / cfg.pageSize))
    const rest = await mapLimit(
      Array.from({ length: pages - 1 }, (_, i) => i + 2),
      cfg.concurrency,
      (pageNo) => fetchPage(cfg, source, { ...base, pageNo }),
    )
    const seen = new Set<string>()
    const items: LostItem[] = []
    for (const page of [first, ...rest]) {
      for (const raw of page.items) {
        const row = normalize(raw, source, region)
        if (seen.has(row.id) || !(row.title || row.productName)) continue
        seen.add(row.id)
        items.push(row)
      }
    }
    return {
      items,
      stat: {
        totalCount: total,
        receivedCount: items.length,
        complete: total !== null && items.length >= total,
        resultCode: first.resultCode,
        resultMsg: first.resultMsg,
      },
    }
  }

  function cached(source: Source, start: string, end: string, region: string): Promise<SourceData> {
    const key = [source, start, end, region].join('|')
    const now = Date.now()
    for (const [k, v] of cache) if (now - v.at > cfg.cacheTtlMs) cache.delete(k)
    const hit = cache.get(key)
    if (hit) return hit.promise
    const promise = loadSource(source, start, end, region)
    cache.set(key, { at: now, promise })
    promise.catch(() => cache.delete(key))
    return promise
  }

  async function search(q: SearchInput): Promise<SearchResponse & { httpStatus: number }> {
    const empty = { items: [], matchedCount: 0, receivedCount: 0, complete: false, pageNo: q.pageNo, numOfRows: q.numOfRows, pageCount: 0, bySource: {} }
    const invalid = (message: string) => ({ ...empty, status: 'invalid_request' as const, message, httpStatus: 400 })

    if (!cfg.apiKey) return { ...empty, status: 'config_error', message: '서버에 공식 API 인증키(LOST112_API_KEY)가 설정되지 않았습니다.', httpStatus: 503 }
    if (!isYmd(q.START_YMD) || !isYmd(q.END_YMD) || q.START_YMD > q.END_YMD) return invalid('시작일과 종료일을 확인해 주세요.')
    const days = (ymdToDate(q.END_YMD).getTime() - ymdToDate(q.START_YMD).getTime()) / 86_400_000 + 1
    if (days > cfg.maxRangeDays) return invalid(`조회 기간은 최대 ${cfg.maxRangeDays}일까지 선택할 수 있습니다.`)
    const region = q.region === '지역전체' ? '' : q.region
    if (region && !REGION_CODES.has(region)) return invalid('지원하지 않는 지역코드입니다.')

    const sources: Source[] = q.institution === '경찰관서' ? ['police'] : q.institution === '포털기관' ? ['portal'] : ['police', 'portal']
    let data: SourceData[]
    try {
      data = await Promise.all(sources.map((s) => cached(s, q.START_YMD, q.END_YMD, region)))
    } catch (e) {
      const d = e instanceof UpstreamError ? e.detail : {}
      const detail = [d.httpStatus && `HTTP ${d.httpStatus}`, d.resultCode && `코드 ${d.resultCode}`, d.resultMsg].filter(Boolean).join(' · ')
      const message = (e instanceof UpstreamError ? e.message : '공식 API 호출 중 오류가 발생했습니다.') + (detail ? ` (${detail})` : '') + ' 실제 유실물 0건을 뜻하지 않습니다.'
      return { ...empty, status: 'upstream_error', message, httpStatus: 502 }
    }

    const lo = `${q.START_YMD.slice(0, 4)}-${q.START_YMD.slice(4, 6)}-${q.START_YMD.slice(6, 8)}`
    const hi = `${q.END_YMD.slice(0, 4)}-${q.END_YMD.slice(4, 6)}-${q.END_YMD.slice(6, 8)}`
    const terms = q.category && q.category !== '분류전체' ? CATEGORY_TERMS[q.category] ?? [q.category] : null
    const keyword = q.keyword.trim().toLocaleLowerCase('ko-KR')

    const all = data.flatMap((d) => d.items)
    const matched = all.filter((x) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(x.pickupDate) && (x.pickupDate < lo || x.pickupDate > hi)) return false
      if (terms && !terms.some((t) => x.category.includes(t))) return false
      if (keyword && !`${x.title} ${x.productName} ${x.keepingplace}`.toLocaleLowerCase('ko-KR').includes(keyword)) return false
      return true
    })
    matched.sort((a, b) => (a.pickupDate === b.pickupDate ? (a.id < b.id ? 1 : -1) : a.pickupDate < b.pickupDate ? 1 : -1))

    const bySource: SearchResponse['bySource'] = {}
    sources.forEach((s, i) => (bySource[s] = data[i].stat))
    const complete = data.every((d) => d.stat.complete)
    return {
      status: 'ok',
      message: complete ? undefined : `조회 건수가 많아 출처별 최근 ${cfg.maxItemsPerSource.toLocaleString('ko-KR')}건까지만 검색했습니다. 기간이나 지역을 좁혀 주세요.`,
      items: matched.slice((q.pageNo - 1) * q.numOfRows, q.pageNo * q.numOfRows),
      matchedCount: matched.length,
      receivedCount: all.length,
      complete,
      pageNo: q.pageNo,
      numOfRows: q.numOfRows,
      pageCount: Math.ceil(matched.length / q.numOfRows),
      bySource,
      fetchedAt: new Date().toISOString(),
      httpStatus: 200,
    }
  }

  return { search, clearCache: () => cache.clear() }
}
