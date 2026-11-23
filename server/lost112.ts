import { XMLParser } from 'fast-xml-parser'
import type { LostItem, Source } from '../shared/types.ts'

/** 경찰청 습득물(police) / 포털기관 습득물(portal) 조회 서비스 경로. */
export const ENDPOINTS: Record<Source, string> = {
  police: 'LosfundInfoInqireService/getLosfundInfoAccToClAreaPd',
  portal: 'LosPtfundInfoInqireService/getPtLosfundInfoAccToClAreaPd',
}

export const SOURCE_LABEL: Record<Source, string> = { police: '경찰관서', portal: '포털기관' }

export type QueryParams = {
  START_YMD: string
  END_YMD: string
  N_FD_LCT_CD?: string
  PRDT_CL_CD_01?: string
  PRDT_CL_CD_02?: string
  pageNo: number
  numOfRows: number
}

export type RawItem = Record<string, unknown>

export type PageResult = {
  resultCode: string
  resultMsg: string
  totalCount: number | null
  items: RawItem[]
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly detail: { httpStatus?: number; resultCode?: string; resultMsg?: string } = {},
  ) {
    super(message)
  }
}

export type ClientConfig = {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true })

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim()
const asArray = <T>(v: T | T[] | undefined | null | ''): T[] => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v])

/** 응답 본문(JSON 또는 XML)을 해석해 공통 구조로 변환한다. */
export function parseBody(text: string): PageResult {
  const trimmed = text.trim()
  if (!trimmed) throw new UpstreamError('공식 API가 빈 응답을 반환했습니다.')
  let doc: any
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      doc = JSON.parse(trimmed)
    } catch {
      throw new UpstreamError('공식 API 응답(JSON)을 해석하지 못했습니다.')
    }
  } else if (trimmed.startsWith('<')) {
    doc = xml.parse(trimmed)
  } else {
    throw new UpstreamError('공식 API 응답 형식을 알 수 없습니다.', { resultMsg: trimmed.slice(0, 120) })
  }

  // data.go.kr 계열 인증/서비스 오류 응답
  const svcErr = doc?.OpenAPI_ServiceResponse?.cmmMsgHeader
  if (svcErr) {
    throw new UpstreamError('공식 API 인증 또는 서비스 오류입니다.', {
      resultCode: str(svcErr.returnReasonCode),
      resultMsg: str(svcErr.returnAuthMsg || svcErr.errMsg),
    })
  }

  const response = doc?.response ?? doc
  const header = response?.header ?? {}
  const body = response?.body ?? {}
  const resultCode = str(header.resultCode ?? response?.resultCode)
  const resultMsg = str(header.resultMsg ?? header.resultMag ?? response?.resultMsg ?? response?.resultMag)

  if (!resultCode && !response?.body) {
    // 게이트웨이(koreaconnect) 자체 오류 등 예상 밖 구조
    const msg = str(doc?.message ?? doc?.error ?? doc?.msg ?? doc?.resultMsg)
    throw new UpstreamError('공식 API 응답 구조를 인식하지 못했습니다.', { resultMsg: msg || trimmed.slice(0, 120) })
  }
  if (resultCode && resultCode !== '00' && resultCode !== '0') {
    throw new UpstreamError('공식 API가 오류 코드를 반환했습니다.', { resultCode, resultMsg })
  }

  const totalRaw = body.totalCount
  const totalCount = totalRaw === undefined || totalRaw === '' ? null : Number(totalRaw)
  const items = asArray<RawItem>(body.items?.item ?? (Array.isArray(body.items) ? body.items : undefined))
  return { resultCode: resultCode || '00', resultMsg, totalCount: Number.isFinite(totalCount) ? totalCount : null, items }
}

export async function fetchPage(cfg: ClientConfig, source: Source, q: QueryParams): Promise<PageResult> {
  const url = new URL(cfg.baseUrl.replace(/\/+$/, '') + '/' + ENDPOINTS[source])
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const doFetch = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { api_user_key_id: cfg.apiKey, Accept: 'application/json, application/xml;q=0.9, */*;q=0.5' },
      redirect: 'error',
      signal: AbortSignal.timeout(cfg.timeoutMs),
    })
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new UpstreamError(timeout ? '공식 API 응답 시간이 초과되었습니다.' : '공식 API에 연결하지 못했습니다.')
  }
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 200)
    try {
      msg = parseBody(text).resultMsg || msg
    } catch (e) {
      if (e instanceof UpstreamError && e.detail.resultMsg) msg = e.detail.resultMsg
    }
    throw new UpstreamError(`공식 API가 HTTP ${res.status} 오류를 반환했습니다.`, { httpStatus: res.status, resultMsg: msg })
  }
  return parseBody(text)
}

/** 괄호 안 상세 특징(개인정보가 섞일 수 있음)은 숨긴다. */
export const redact = (v: unknown) => str(v).replace(/[(（].*/, '(상세 특징은 원본 사이트 확인)').trim()

export const isoDate = (v: unknown) => {
  const d = str(v).replace(/\D/g, '').slice(0, 8)
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : str(v)
}

export function normalize(raw: RawItem, source: Source, regionCode: string): LostItem {
  return {
    id: `${source}:${str(raw.atcId)}:${str(raw.fdSn)}`,
    title: redact(raw.fdSbjt || raw.fdPrdtNm),
    productName: redact(raw.fdPrdtNm),
    category: str(raw.prdtClNm),
    color: str(raw.clrNm),
    keepingplace: str(raw.depPlace),
    pickupDate: isoDate(raw.fdYmd),
    sourceInstitution: SOURCE_LABEL[source],
    status: str(raw.csteSteNm),
    regionCode,
    source,
  }
}
