export type Source = 'police' | 'portal'

export type LostItem = {
  id: string
  title: string
  productName: string
  category: string
  color: string
  keepingplace: string
  pickupDate: string
  sourceInstitution: string
  status: string
  regionCode: string
  source: Source
}

export type SourceStat = {
  /** 공식 API가 알려준 전체 건수 (지역·기간 조건 기준, 품목·검색어 필터 전). */
  totalCount: number | null
  /** 실제로 받아온 건수. */
  receivedCount: number
  /** totalCount 만큼 모두 받아왔는지. */
  complete: boolean
  resultCode: string
  resultMsg: string
}

export type SearchStatus = 'ok' | 'invalid_request' | 'config_error' | 'upstream_error'

export type SearchResponse = {
  status: SearchStatus
  message?: string
  items: LostItem[]
  matchedCount: number
  receivedCount: number
  complete: boolean
  pageNo: number
  numOfRows: number
  pageCount: number
  bySource: Partial<Record<Source, SourceStat>>
  fetchedAt?: string
  cached?: boolean
}
