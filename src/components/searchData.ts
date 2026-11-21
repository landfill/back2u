export type SearchForm = { start_date: string; end_date: string; region: string; institution: string; item_type: string; keyword: string }

export const regions = ['지역전체', '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도']
export const institutions = ['기관전체', '경찰관서', '포털기관']
export const itemTypes = [
  { value: '분류전체', icon: '◎', note: '모든 물품 분류' },
  { value: '가방·지갑', icon: '▣', note: '가방·지갑 등' },
  { value: '전자기기', icon: '▤', note: '휴대전화·전자기기' },
  { value: '의류·잡화', icon: '◇', note: '의류·생활잡화' },
  { value: '카드·서류', icon: '▱', note: '카드·증명서류' },
  { value: '기타', icon: '○', note: '그 외 물품' },
]
export const emptyForm: SearchForm = { start_date: '', end_date: '', region: '지역전체', institution: '기관전체', item_type: '분류전체', keyword: '' }
