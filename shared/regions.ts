/** 경찰청 유실물 API 공식 상위 지역코드 (N_FD_LCT_CD). */
export type Region = { cdNm: string; commCd: string }

export const REGIONS: Region[] = [
  ['서울특별시', 'LCA000'],
  ['부산광역시', 'LCT000'],
  ['대구광역시', 'LCR000'],
  ['인천광역시', 'LCV000'],
  ['광주광역시', 'LCQ000'],
  ['대전광역시', 'LCS000'],
  ['울산광역시', 'LCU000'],
  ['세종특별자치시', 'LCW000'],
  ['경기도', 'LCI000'],
  ['강원도', 'LCH000'],
  ['충청북도', 'LCO000'],
  ['충청남도', 'LCN000'],
  ['전라북도', 'LCM000'],
  ['전라남도', 'LCL000'],
  ['경상북도', 'LCK000'],
  ['경상남도', 'LCJ000'],
  ['제주특별자치도', 'LCP000'],
  ['전남광주통합특별시', 'LCG000'],
  ['해외', 'LCF000'],
  ['기타', 'LCE000'],
].map(([cdNm, commCd]) => ({ cdNm, commCd }))

export const REGION_CODES = new Set(REGIONS.map((r) => r.commCd))
