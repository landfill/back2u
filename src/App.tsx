import { FormEvent, useEffect, useRef, useState } from 'react'
import { api } from './lib/api'
import { emptyForm, SearchForm } from './components/searchData'
import { REGIONS, type Region } from '../shared/regions'
import type { LostItem as Row, SearchResponse } from '../shared/types'

type Result = Omit<SearchResponse,'status'> & { status:SearchResponse['status']|'call_failed' }
type Meta = { regions:Region[]; maxRangeDays:number; maxItemsPerSource:number; apiKeyConfigured:boolean }
const STORAGE_KEY = 'back2u-search-preferences-v3'
const CATEGORY_OPTIONS = ['분류전체','가방·지갑','전자기기','의류·잡화','카드·서류','기타','지갑','휴대폰','가방','카드','우산']
const QUICK_CATEGORIES = ['지갑','휴대폰','가방','카드','우산','전자기기']
const number = (v:number|undefined|null) => typeof v === 'number' ? v.toLocaleString('ko-KR') : '미확인'
const atcId = (row:Row) => row.id.split(':')[1]||row.id
const dot = (v:string) => v.replaceAll('-','.')
const shortDate = (v:string) => v ? dot(v).slice(5) : '미선택'
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
function shiftDate(value:string,days:number){const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
const daysBetween=(a:string,b:string)=>Math.round((new Date(b+'T12:00:00Z').getTime()-new Date(a+'T12:00:00Z').getTime())/86400000)+1
const defaultForm=():SearchForm=>({...emptyForm,start_date:shiftDate(today(),-6),end_date:today()})
const formatKst=(v?:string)=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))+' KST':''
function restore(value:unknown,defaults:SearchForm):SearchForm { const result={...defaults};if(value&&typeof value==='object')for(const key of Object.keys(defaults) as (keyof SearchForm)[]){const v=(value as Record<string,unknown>)[key];if(typeof v==='string')result[key]=v}return result }
function stamp(row:Row){const label=row.status?.trim()||'상태 확인';return {label,tone:!row.status?'':/반환|수령|인도|이관|폐기/.test(label)?'is-returned':/보관/.test(label)?'is-kept':''}}
function SearchIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>}

export default function App(){
 const [form,setForm]=useState<SearchForm>(defaultForm)
 const [applied,setApplied]=useState<SearchForm>(defaultForm)
 const [result,setResult]=useState<Result|null>(null)
 const [metadata,setMetadata]=useState<Meta|null>(null)
 const [metaError,setMetaError]=useState(false)
 const [loading,setLoading]=useState(true)
 const [selected,setSelected]=useState<Row|null>(null)
 const [periodError,setPeriodError]=useState('')
 const [toast,setToast]=useState('')
 const [saving,setSaving]=useState(false)
 const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const searchId=useRef(0)
 const dialogRef=useRef<HTMLDivElement>(null)
 const previousFocus=useRef<HTMLElement|null>(null)
 const notify=(message:string)=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(message);toastTimer.current=setTimeout(()=>setToast(''),4200)}
 const comingSoon=()=>notify('준비중입니다')
 const patch=(key:keyof SearchForm,value:string)=>{setForm(f=>({...f,[key]:value}));if(key==='start_date'||key==='end_date')setPeriodError('')}
 const regionOptions:Region[]=metadata?.regions?.length?metadata.regions:REGIONS
 const maxRangeDays=metadata?.maxRangeDays||92
 const regionLabel=(value:string)=>value==='지역전체'?'전국 전체':regionOptions.find(x=>x.commCd===value)?.cdNm||value
 const rowRegion=(row:Row)=>row.regionCode?regionLabel(row.regionCode):'전국 조회 · 지역 미지정'
 const police=result?.bySource?.police, portal=result?.bySource?.portal

 const runSearch=async(criteria:SearchForm,pageNo=1,move=false)=>{
  if(!criteria.start_date||!criteria.end_date||criteria.start_date>criteria.end_date){setPeriodError('시작일과 종료일을 모두 선택하고, 시작일이 더 늦지 않은지 확인해 주세요.');return}
  if(daysBetween(criteria.start_date,criteria.end_date)>maxRangeDays){setPeriodError(`조회 기간은 최대 ${maxRangeDays}일까지 선택할 수 있어요.`);return}
  const id=++searchId.current
  setSelected(null);setLoading(true);setResult(null);setPeriodError('');setApplied({...criteria})
  try{
   const query=new URLSearchParams({START_YMD:criteria.start_date.replaceAll('-',''),END_YMD:criteria.end_date.replaceAll('-',''),pageNo:String(pageNo),numOfRows:'20',region:criteria.region||'지역전체',institution:criteria.institution||'기관전체',category:criteria.item_type||'분류전체',keyword:criteria.keyword.trim()})
   const response=await api('lost-items?'+query)
   const data=await response.json().catch(()=>null) as SearchResponse|null
   if(!data||!data.status)throw new Error('request_failed')
   if(id!==searchId.current)return
   setResult(data.status==='ok'?data:{...data,items:[]})
  }catch{if(id===searchId.current)setResult({status:'call_failed',items:[],matchedCount:0,receivedCount:0,complete:false,pageNo,numOfRows:20,pageCount:0,bySource:{},message:'서버에 연결하지 못했습니다. 실제 유실물 0건을 뜻하지 않습니다. 잠시 후 다시 시도해 주세요.'})}
  finally{if(id===searchId.current){setLoading(false);if(move)document.getElementById('lf-results')?.scrollIntoView({behavior:'smooth',block:'start'})}}
 }
 useEffect(()=>{
  let active=true
  const init=async()=>{
   let local:unknown=null
   try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)local=JSON.parse(raw)}catch{}
   const meta=await api('meta').then(r=>{if(!r.ok)throw new Error();return r.json() as Promise<Meta>}).catch(()=>null)
   if(!active)return
   if(meta)setMetadata(meta);else setMetaError(true)
   const initial=restore(local,defaultForm())
   if(initial.end_date>today()||initial.start_date>initial.end_date){initial.start_date=shiftDate(today(),-6);initial.end_date=today()}
   setForm(initial)
   void runSearch(initial)
  }
  void init()
  return()=>{active=false;if(toastTimer.current)clearTimeout(toastTimer.current)}
 },[])
 useEffect(()=>{
  if(!selected)return
  previousFocus.current=document.activeElement as HTMLElement|null
  const oldOverflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  const handleKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){setSelected(null);return}
   if(event.key!=='Tab'||!dialogRef.current)return
   const nodes=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,[tabindex="0"]'))
   const first=nodes[0],last=nodes[nodes.length-1]
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  }
  document.addEventListener('keydown',handleKey)
  return()=>{document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',handleKey);previousFocus.current?.focus()}
 },[selected])
 const submit=(event:FormEvent)=>{event.preventDefault();void runSearch({...form},1,true)}
 const save=()=>{
  if(!form.start_date||!form.end_date||form.start_date>form.end_date){setPeriodError('저장할 시작일과 종료일을 확인해 주세요.');return}
  setSaving(true)
  let saved=false
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({...form}));saved=true}catch{}
  notify(saved?'이 브라우저에 검색 조건을 저장했습니다.':'검색 조건을 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.')
  setSaving(false)
 }
 const reset=()=>{setForm(defaultForm());setPeriodError('');notify('검색 조건을 초기화했습니다. 찾기를 누르면 최근 7일 전체를 조회해요.')}
 const choosePeriod=(days:number)=>{
  const end=today(),start=shiftDate(end,-(days-1))
  if(days>maxRangeDays){notify(`조회 기간은 최대 ${maxRangeDays}일까지 선택할 수 있어요.`);return}
  setForm(f=>({...f,start_date:start,end_date:end}));setPeriodError('')
 }
 const filterInstitution=(value:string)=>{const next={...form,institution:value};setForm(next);void runSearch(next)}
 const goodResult=result?.status==='ok'
 const countText=loading?'…':goodResult?number(result?.matchedCount):'확인 필요'
 const resultTitle='등록된 습득물'
 const summary=`${dot(applied.start_date)} ~ ${dot(applied.end_date)} · ${regionLabel(applied.region)} · ${applied.item_type==='분류전체'?'모든 품목':applied.item_type}${applied.keyword?' · '+applied.keyword:''}`
 const failureTitle=result?.status==='invalid_request'?'검색 조건을 확인해 주세요':result?.status==='config_error'?'서비스 설정을 확인해 주세요':'공식 API 응답을 확인하지 못했어요'
 const totalPages=Math.max(result?.pageCount||1,1)
 const displayStatus=selected?stamp(selected):null

 return <div className="lf-app" id="top">
  <div className="lf-hero">
   <header className="lf-header">
    <a className="lf-brand" href="#top" aria-label="찾아줘 처음으로"><span className="lf-brand-name">찾아줘</span><span className="lf-brand-tag">LOST &amp; FOUND</span></a>
    <nav className="lf-nav" aria-label="주 메뉴"><a href="#search" className="is-current" aria-current="page">유실물 찾기</a><button type="button" onClick={comingSoon}>분실 신고</button><a href="#guide">이용 안내</a></nav>
   </header>
   <section className="lf-hero-body" aria-labelledby="lf-title">
    <div className="lf-hero-copy"><p className="lf-eyebrow">유실물 통합 검색 · 경찰관서 · 지하철 · 참여기관</p><h1 id="lf-title">잃어버린 건,<br/>여기서 찾아봐요.</h1><p className="lf-hero-description">언제 · 어디서 · 무엇을. 기억나는 조건으로<br className="lf-desktop-break"/> 경찰청 공식 유실물 데이터를 실시간으로 찾아보세요.</p></div>
    <div className="lf-hero-art" aria-hidden="true"><div className="lf-art-ticket one"><small>NO. 1119-002</small><strong>검정 반지갑</strong></div><div className="lf-art-ticket two"><small>NO. 1120-001</small><strong>아이폰</strong></div><div className="lf-art-ticket three"><small>NO. 1116-009</small><strong>검정 장우산</strong></div><span className="lf-art-caption">보관증 디자인 예시</span></div>
   </section>
   <div className="lf-ticker"><p><span className="lf-ticker-badge">LIVE</span>{metaError?'서버 연결 확인이 필요합니다. 실제 0건을 의미하지 않습니다.':metadata&&!metadata.apiKeyConfigured?'공식 API 인증키가 아직 설정되지 않았습니다.':'경찰청 습득물 · 포털기관 습득물 공식 API를 검색할 때마다 조회합니다.'}</p></div>
  </div>
  <main className="lf-main">
   <section id="search" className="lf-search" aria-labelledby="lf-search-title">
    <form id="lf-search-form" className="lf-search-form" onSubmit={submit} noValidate>
     <div className="lf-search-heading"><h2 id="lf-search-title">분실 보관증 작성</h2><p>검색용 조건표 · 기간만 필수예요</p></div>
     <div className="lf-search-fields">
      <div className="lf-field-group is-period">
       <label className="lf-label" htmlFor="lf-from"><span className="lf-step">01</span>언제 · 분실 기간<span className="lf-required" aria-hidden="true">*</span></label>
       <div className="lf-field-row"><input id="lf-from" className={'lf-field'+(periodError?' is-invalid':'')} aria-label="분실 기간 시작일" aria-required="true" aria-invalid={!!periodError} aria-describedby={periodError?'lf-period-error':undefined} type="date" value={form.start_date} max={today()} onChange={e=>patch('start_date',e.target.value)}/><span className="lf-period-separator" aria-hidden="true">~</span><input id="lf-to" className={'lf-field'+(periodError?' is-invalid':'')} aria-label="분실 기간 종료일" aria-required="true" aria-invalid={!!periodError} type="date" value={form.end_date} max={today()} onChange={e=>patch('end_date',e.target.value)}/></div>
       <div className="lf-chips" role="group" aria-label="기간 빠른 선택">{[{label:'오늘',days:1},{label:'최근 7일',days:7},{label:'최근 1개월',days:30},{label:'최근 3개월',days:90}].map(p=>{const active=form.end_date===today()&&form.start_date===shiftDate(today(),-(p.days-1));return <button className={'lf-chip'+(active?' is-active':'')} type="button" aria-pressed={active} key={p.label} onClick={()=>choosePeriod(p.days)}>{p.label}</button>})}</div>
       {periodError&&<p className="lf-field-error" id="lf-period-error" role="alert">{periodError}</p>}
      </div>
      <div className="lf-field-group is-region">
       <label className="lf-label" htmlFor="lf-region"><span className="lf-step">02</span>어디서 · 분실 지역</label>
       <div className="lf-field-row"><select id="lf-region" className="lf-field" aria-label="공식 지역코드" value={form.region} onChange={e=>patch('region',e.target.value)}><option value="지역전체">전국 전체</option>{regionOptions.map(r=><option key={r.commCd} value={r.commCd}>{r.cdNm}</option>)}{form.region!=='지역전체'&&!regionOptions.some(r=>r.commCd===form.region)&&<option value={form.region}>{regionLabel(form.region)} · 미지원 코드</option>}</select><button className="lf-field lf-soon-select" aria-label="시/군/구 검색 준비중" type="button" onClick={comingSoon}><span>시/군/구 전체</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg></button></div>
       <p className="lf-help">공식 상위 20지역만 검색합니다. 시/군/구 세부 검색은 준비 중이에요.</p>
      </div>
      <div className="lf-field-group is-name">
       <label className="lf-label" htmlFor="lf-keyword"><span className="lf-step">03</span>무엇을 · 분실물 품명</label>
       <div className="lf-name-fields"><input id="lf-keyword" className="lf-field" type="search" placeholder="예: 검정 반지갑, 아이폰" value={form.keyword} onChange={e=>patch('keyword',e.target.value)}/><select className="lf-field" aria-label="물품 분류" value={form.item_type} onChange={e=>patch('item_type',e.target.value)}>{CATEGORY_OPTIONS.map(category=><option key={category} value={category}>{category==='분류전체'?'물품 분류 전체':category}</option>)}{!CATEGORY_OPTIONS.includes(form.item_type)&&<option value={form.item_type}>{form.item_type}</option>}</select></div>
       <div className="lf-chips" role="group" aria-label="자주 찾는 품목">{QUICK_CATEGORIES.map(category=><button type="button" className={'lf-chip'+(form.item_type===category?' is-active':'')} key={category} aria-pressed={form.item_type===category} onClick={()=>patch('item_type',form.item_type===category?'분류전체':category)}># {category}</button>)}</div>
       <p className="lf-help">품명·제목·보관처로 검색해요. 비워두면 전체 품목을 조회합니다.</p>
      </div>
     </div>
     <div className="lf-form-actions"><button type="button" className="lf-reset" onClick={reset}>입력 내용 지우기</button><button type="button" className="lf-save-query" onClick={save} disabled={saving}>{saving?'저장 중…':'현재 검색조건 저장'}</button></div>
    </form>
    <div className="lf-claim"><div><p className="lf-claim-label">SEARCH TICKET</p><p className="lf-claim-period">{shortDate(form.start_date)}<br/>— {shortDate(form.end_date)}</p><p className="lf-help">{regionLabel(form.region)}</p></div><button type="submit" form="lf-search-form" className="lf-find" disabled={loading} aria-label={loading?'유실물 조회 중':'유실물 찾기'}><SearchIcon/>{loading?'조회 중':'찾기'}</button></div>
   </section>
   <section className="lf-scope" aria-label="공식 API 조회 범위"><strong>경찰청 공식 API 실시간 조회 · 최대 {maxRangeDays}일</strong><p>{result?.status==='ok'?`${dot(applied.start_date)} ~ ${dot(applied.end_date)} · 공식 전체 ${police?`경찰 ${number(police.totalCount)}건`:''}${police&&portal?' + ':''}${portal?`포털기관 ${number(portal.totalCount)}건`:''} · ${result.complete?'전체 수신 확인':'일부만 수신'}`:'검색하면 기간·지역 기준 공식 전체 건수를 함께 보여드려요.'}</p><p>{result?.fetchedAt?`조회 ${formatKst(result.fetchedAt)} · `:''}공식 지역코드로만 검색하며 보관처 이름에서 지역을 추정하지 않습니다. 현재 보관상태·전화번호·세부 습득장소는 원본에서 확인해 주세요.</p></section>
   <section id="lf-results" className="lf-results" aria-labelledby="lf-result-title" aria-busy={loading}>
        <div className="lf-results-heading"><h2 id="lf-result-title">{resultTitle} <span className="lf-count" aria-live="polite">{countText}</span></h2><div className="lf-results-summary"><p>{summary}</p><small>습득일 최신순 · 경찰청 공식 API 실시간 조회</small></div></div>
    <div className="lf-results-tools"><div className="lf-provider-filters" role="group" aria-label="기관 필터">{['기관전체','경찰관서','포털기관'].map(value=><button key={value} type="button" className={applied.institution===value?'is-active':''} aria-pressed={applied.institution===value} onClick={()=>filterInstitution(value)}>{value==='기관전체'?'전체 기관':value}</button>)}</div><p className="lf-source-totals">{result?.status==='ok'?`선택기관 수신 ${number(result.receivedCount)}건 · 조건 일치 ${number(result.matchedCount)}건 · 현재 ${result.items.length}건 표시`:'연결·수신 상태와 검색 결과를 구분합니다.'}</p></div>
    {loading?<div className="lf-empty" role="status"><h3>보관 정보를 찾고 있어요</h3><p>공식 API에서 조건에 맞는 항목을 확인하고 있습니다. 기간이 길면 조금 걸릴 수 있어요.</p></div>:!goodResult?<div className="lf-empty lf-error-panel" role="status"><h3>{failureTitle}</h3><p>{result?.message||'조회 상태를 확인하지 못했습니다. 실제 0건을 뜻하지 않습니다.'}</p><button type="button" onClick={()=>void runSearch({...form})}>다시 조회</button></div>:result?.items.length===0?<div className="lf-empty" role="status"><h3>조건에 맞는 항목이 없어요</h3><p>{result.complete?'공식 API의 해당 기간 전체 목록에서 일치하는 항목이 없습니다.':'받아온 목록에서 일치하는 항목을 찾지 못했습니다. 건수가 많아 일부만 검색했어요.'} 기간·지역·품목을 넓혀 다시 찾아보세요.</p></div>:<ul className="lf-card-grid" aria-label="습득물 검색 결과">{result?.items.map(row=>{const state=stamp(row);return <li key={row.id}><article className="lf-card"><span className="lf-card-hole" aria-hidden="true"/><div className="lf-card-top"><span className="lf-card-code" title={atcId(row)}>{atcId(row)}</span><span className="lf-card-category" title={row.category}>{row.category||'분류 미제공'}</span></div><h3><button type="button" className="lf-card-title" onClick={()=>setSelected(row)}>{row.productName||row.title}</button></h3><p className="lf-card-provider">{row.sourceInstitution}</p><dl><dt>습득일</dt><dd className="lf-mono">{dot(row.pickupDate)||'미제공'}</dd><dt>지역</dt><dd>{rowRegion(row)}</dd><dt>보관</dt><dd>{row.keepingplace||'원본 목록에 미제공'}</dd></dl><div className="lf-card-bottom"><span className={'lf-stamp '+state.tone} title={row.status||'목록에 현재 보관상태가 제공되지 않습니다.'}>{state.label}</span><button type="button" className="lf-claim-button" onClick={comingSoon}>수령 신청 →</button></div><button type="button" className="lf-details-link" onClick={()=>setSelected(row)}>상세 보기</button></article></li>})}</ul>}
    {result?.status==='ok'&&!loading&&<><div className="lf-pagination" aria-label="검색 결과 페이지"><button type="button" disabled={(result.pageNo||1)<=1} onClick={()=>void runSearch({...applied},(result.pageNo||1)-1,true)}>이전 페이지</button><p>{number(result.pageNo||1)} / {number(totalPages)} 페이지</p><button type="button" disabled={(result.pageNo||1)>=totalPages} onClick={()=>void runSearch({...applied},(result.pageNo||1)+1,true)}>다음 페이지</button></div>{result.message&&<p className="lf-legacy-note" role="status">{result.message}</p>}{(police||portal)&&<p className="lf-region-counts">{regionLabel(applied.region)} 공식 전체건수: {police?`경찰 ${number(police.totalCount)}건`:''}{police&&portal?' · ':''}{portal?`포털기관 ${number(portal.totalCount)}건`:''}. 품목·검색어 필터 전 기준입니다.</p>}</>}
   </section>
   <section id="report" className="lf-report" aria-labelledby="lf-report-title"><div className="lf-report-copy"><h2 id="lf-report-title">못 찾았다면, 맡겨두세요.</h2><p>분실 신고와 같은 조건의 새 습득물 알림은 준비 중이에요.<br/>보관·반환 상태는 공식 사이트에서 최종 확인해 주세요.</p></div><div className="lf-report-actions"><button type="button" onClick={comingSoon}>분실 신고 등록</button><button type="button" className="secondary" onClick={comingSoon}>수령 절차 보기</button></div></section>
  </main>
  <footer className="lf-footer" id="guide"><div className="lf-footer-inner"><p><span className="lf-footer-brand">찾아줘</span>경찰청 · 참여 포털기관 공식 유실물 데이터</p><p><a href="https://www.lost112.go.kr/" target="_blank" rel="noreferrer">LOST112 공식 안내 ↗</a></p></div><section className="lf-guide" aria-labelledby="lf-guide-title"><h3 id="lf-guide-title">방문 전에 확인하세요</h3><p>관리 기관에 현재 보관상태와 수령방법을 먼저 확인하고 신분증과 물건의 특징을 준비하세요. 목록 조회 후에도 반환·이관될 수 있습니다. 목록에 없는 연락처·상태·세부 위치는 만들지 않습니다.</p><p>분실 신고·수령 신청·시/군/구 검색은 준비 중입니다.</p></section></footer>
  {selected&&<div className="lf-modal-backdrop" onClick={event=>{if(event.target===event.currentTarget)setSelected(null)}}><div className="lf-modal" role="dialog" aria-modal="true" aria-labelledby="lf-detail-title" ref={dialogRef}><button type="button" className="lf-modal-close" aria-label="상세 닫기" onClick={()=>setSelected(null)}>×</button><p className="lf-claim-label" style={{color:'#746d62'}}>FOUND ITEM DETAILS</p><h2 id="lf-detail-title">{selected.productName||selected.title}</h2><dl>{[['관리 ID',atcId(selected)],['습득일',selected.pickupDate],['물품분류',selected.category],['보관처',selected.keepingplace],['접수기관',selected.sourceInstitution],['조회 지역',rowRegion(selected)],['보관상태',selected.status||'원본 목록에 미제공 · 현재 상태 확인 필요']].map(([label,value])=><div className="lf-detail-row" key={label}><dt>{label}</dt><dd>{value||'원본 목록에 미제공'}</dd></div>)}</dl><p className="lf-modal-note">경찰청 공식 API 조회 결과입니다. 조회 이후 상태가 달라질 수 있어요. 개인정보 보호를 위해 사진·괄호 속 상세 특징은 원본 사이트에서 확인합니다. 목록에 없는 전화번호·상태·세부 습득위치는 제공하지 않습니다.</p><div className="lf-modal-actions"><a href="https://www.lost112.go.kr/" target="_blank" rel="noreferrer">공식 원문·현재 상태 확인 ↗</a><button type="button" className="secondary" onClick={comingSoon}>수령 신청</button></div></div></div>}
  {toast&&<div className="lf-toast" role="status" aria-live="polite" aria-atomic="true"><span>{toast}</span><button type="button" aria-label="알림 닫기" onClick={()=>setToast('')}>×</button></div>}
 </div>
}
