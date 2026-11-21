import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBody, normalize, UpstreamError } from './lost112.ts'
import { createApp } from './app.ts'

const jsonPage = (items: object[], totalCount: number) =>
  JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { items: { item: items }, numOfRows: 1000, pageNo: 1, totalCount } } })

const xmlPage = (items: string, totalCount: number) =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items}</items><numOfRows>10</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`

test('parseBody: JSON with array items', () => {
  const r = parseBody(jsonPage([{ atcId: 'F1', fdSn: '1' }, { atcId: 'F2', fdSn: '1' }], 2))
  assert.equal(r.totalCount, 2)
  assert.equal(r.items.length, 2)
})

test('parseBody: XML with a single item and resultMag typo', () => {
  const r = parseBody(xmlPage('<item><atcId>F2018080900000674</atcId><fdSn>12</fdSn><fdYmd>2018-06-01</fdYmd></item>', 1).replace(/resultMsg/g, 'resultMag'))
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].atcId, 'F2018080900000674')
  assert.equal(r.resultMsg, 'NORMAL SERVICE.')
})

test('parseBody: empty items', () => {
  const r = parseBody(xmlPage('', 0))
  assert.deepEqual(r.items, [])
  assert.equal(r.totalCount, 0)
})

test('parseBody: data.go.kr style auth error', () => {
  const body = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'
  assert.throws(() => parseBody(body), (e: unknown) => e instanceof UpstreamError && e.detail.resultCode === '30')
})

test('parseBody: non-success resultCode', () => {
  assert.throws(() => parseBody(JSON.stringify({ response: { header: { resultCode: '99', resultMsg: 'ERR' }, body: {} } })), UpstreamError)
})

test('normalize: redacts parenthetical details and formats date', () => {
  const row = normalize({ atcId: 'F1', fdSn: '1', fdPrdtNm: '카드지갑', fdSbjt: '카드지갑(홍길동 명의)색)을 습득', fdYmd: '20261120', prdtClNm: '지갑 > 기타 지갑' }, 'police', 'LCA000')
  assert.equal(row.title, '카드지갑(상세 특징은 원본 사이트 확인)')
  assert.equal(row.pickupDate, '2026-11-20')
  assert.equal(row.sourceInstitution, '경찰관서')
})

function mockFetch() {
  const calls: { url: URL; key: string | null }[] = []
  const police = Array.from({ length: 25 }, (_, i) => ({ atcId: `F${String(i).padStart(4, '0')}`, fdSn: '1', fdPrdtNm: i % 2 ? '검정 반지갑' : '아이폰', fdSbjt: '습득물', prdtClNm: i % 2 ? '지갑 > 남성용 지갑' : '휴대폰 > 스마트폰', depPlace: '서울역파출소', fdYmd: `2026-11-${String(15 + (i % 7)).padStart(2, '0')}` }))
  const portal = [{ atcId: 'V1', fdSn: '1', fdPrdtNm: '우산', fdSbjt: '우산', prdtClNm: '기타물품 > 우산', depPlace: '서울교통공사', fdYmd: '20261121' }]
  const impl = (async (input: URL | string | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, key: new Headers(init?.headers).get('api_user_key_id') })
    const pageNo = Number(url.searchParams.get('pageNo'))
    const size = Number(url.searchParams.get('numOfRows'))
    const all = url.pathname.includes('LosPtfund') ? portal : police
    const body = url.pathname.includes('LosPtfund') ? xmlPage(all.map((x) => `<item>${Object.entries(x).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`).join(''), all.length) : jsonPage(all.slice((pageNo - 1) * size, pageNo * size), all.length)
    return new Response(body, { status: 200 })
  }) as typeof fetch
  return { impl, calls }
}

const cfg = (fetchImpl: typeof fetch, apiKey = 'secret') => ({ baseUrl: 'https://example.test/1320000/', apiKey, timeoutMs: 1000, fetchImpl, pageSize: 10, maxItemsPerSource: 1000, concurrency: 2, cacheTtlMs: 60_000, maxRangeDays: 92 })

test('GET /api/lost-items merges sources, pages upstream, filters and caches', async () => {
  const { impl, calls } = mockFetch()
  const app = createApp(cfg(impl))
  const res = await app.request('/api/lost-items?START_YMD=20261115&END_YMD=20261121&region=LCA000&numOfRows=5')
  assert.equal(res.status, 200)
  const body: any = await res.json()
  assert.equal(body.status, 'ok')
  assert.equal(body.receivedCount, 26)
  assert.equal(body.matchedCount, 26)
  assert.equal(body.complete, true)
  assert.equal(body.items.length, 5)
  assert.equal(body.items[0].pickupDate, '2026-11-21')
  assert.equal(body.bySource.police.totalCount, 25)
  // police: 3 pages of 10, portal: 1 page
  assert.equal(calls.length, 4)
  assert.ok(calls.every((c) => c.key === 'secret'))
  assert.ok(calls.every((c) => c.url.searchParams.get('N_FD_LCT_CD') === 'LCA000'))
  assert.ok(calls[0].url.pathname.endsWith('/1320000/LosfundInfoInqireService/getLosfundInfoAccToClAreaPd'))

  const res2 = await app.request('/api/lost-items?START_YMD=20261115&END_YMD=20261121&region=LCA000&keyword=반지갑&institution=경찰관서')
  const body2: any = await res2.json()
  assert.equal(body2.matchedCount, 12)
  assert.equal(calls.length, 4, 'second query is served from cache')

  const res3 = await app.request('/api/lost-items?START_YMD=20261115&END_YMD=20261121&region=LCA000&category=전자기기')
  assert.equal(((await res3.json()) as any).matchedCount, 13)
})

test('GET /api/lost-items validation and config errors', async () => {
  const { impl } = mockFetch()
  assert.equal((await createApp(cfg(impl, '')).request('/api/lost-items?START_YMD=20261115&END_YMD=20261121')).status, 503)
  const app = createApp(cfg(impl))
  assert.equal((await app.request('/api/lost-items?START_YMD=20261121&END_YMD=20261115')).status, 400)
  assert.equal((await app.request('/api/lost-items?START_YMD=20260101&END_YMD=20261121')).status, 400)
  assert.equal((await app.request('/api/lost-items?START_YMD=20261115&END_YMD=20261121&region=XXX')).status, 400)
})

test('GET /api/lost-items reports upstream errors as 502', async () => {
  const impl = (async () => new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch
  const res = await createApp(cfg(impl)).request('/api/lost-items?START_YMD=20261115&END_YMD=20261121')
  assert.equal(res.status, 502)
  const body: any = await res.json()
  assert.equal(body.status, 'upstream_error')
  assert.match(body.message, /HTTP 401/)
})
