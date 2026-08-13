import { AIProvider } from './aiProvider';
import { drawSatellite, resetSatelliteCache } from './southportView';

// DOM 헬퍼 — 동적 접근 코드의 타입 안전성을 위해 any 반환
const $ = (id: string): any => document.getElementById(id);
const el = (tag: string): any => document.createElementNS('http://www.w3.org/2000/svg', tag);


declare const XLSX: any;   // CDN(SheetJS) 전역 — vite 빌드에서는 타입만 선언

/* =========================================================
   v11: 위험률 모델 정합 (raw_data의 shuffle_yn 기반)

   R1 셔플링 발생 조건 : 출고 차량이 shuffle_yn=Y (행3 30% 선정)
                        → 사람이 출고 불가능, G-Lifter 필요
   R2 Direct Pick-up   : shuffle_yn=N → 셔플링 없이 즉시 출고
   R3 해소 조건        : 해당 셀에 G-Lifter 배치(고위험 상위 3셀)
                        → 셔플링 RESOLVED (차량 인양 출고)
   R4 잔존 조건        : G-Lifter 없는 셀 → 셔플링 PENDING (출고 불가)
   R5 셀 위험도        : 셀의 셔플링 차량 수 기준 3분위
                        (상위 33% HIGH / 중위 33% MID / 하위 34% OK)

   MASTER_차량 컬럼: cell_id/bundle/row/column/plate_no/bl_no/
   model/mfr/order_type/pio_flag/shuffle_yn

   v12: 해소율 정의 변경 + G-Lifter 대수 최적화
   - 해소율 = 해소된 셔플링 건수 / 발생한 셔플링 건수 (셀 기준 → 건수 기준)
   - G-Lifter 대수 UI 입력(1~110) → 위험도 최상위 셀부터 재배치
   - 배치 시 잠재 해소율(커버 셔플링 비율) 표시 → 대수 최적화 지원

   v13: G-Lifter 이동형 + 타임라인
   - G-Lifter가 셔플링 차량을 하나씩 인양하고, 완료 후 다음으로 심각한 셀로 이동
   - 이동 방향: 심각도 순위가 낮아지는 방향(심각 → 덜 심각)으로만 전진
   - 역행 지시(이미 지나간 더 심각한 셀) → PENDING(잔존)
   - 이동/해소/잔존 이벤트를 타임라인(시각순)으로 표시, CSV에도 반영

   v14: G-Lifter 이동 대시보드
   - 사이드바: G-Lifter별 현재 셀/이동 횟수/방문 경로 표시
   - 출고 후 히트맵: 이동 경로(점선) + 경유지 + 현재 위치 마커 표시

   v15: 셔플링 표시 구분
   - G-Lifter 해소 대상 셔플링(행3 shuffle_yn=Y)만 히트맵에 ✅+주황 테두리 표시
   - 사람이 해결 가능한 셔플링(행3 외)은 히트맵에 표시하지 않음
   - 타임라인: 이동 + G-Lifter 셔플링 해소(✅) 이벤트만 표시 (잔존 미표시)

   v16: 단계별 시뮬레이션
   - 출고 실행 시 배치 단위로 <출고 후> 히트맵/타임라인/G-Lifter 이동이 시간순 갱신
   - 속도 선택(5/25/100/일괄 대) + 진행률·경과시간 표시

   v17: 수동 단계 진행
   - 자동 재생 제거 — 버튼 클릭 1회 = 1단계(배치) 진행, G-Lifter 이동 상황을 직접 확인
   - 진행 중 버튼 라벨: '⏭️ 다음 단계 진행'

   v18: 히트맵 테두리 정리
   - <출고 전> 노란 테두리/체크 제거 (위험도 색만 표시)
   - <출고 후> G-Lifter로 해소된 셀에만 파란 테두리

   v19: G-Lifter 위험도 우선 배치
   - 위험도(빨간색) 순위: HIGH > MID > OK, 동일 등급 내 셔플링 수 많은 순
   - G-Lifter를 위험도 최상위 셀부터 배치 (순회 없음 — 지시 셀로 이동)

   v20: 레이아웃 개편
   - 카드 1: 야드 데이터 입력 + 분석 (ctrl-col 400px + analysis-col flex)
   - 카드 2: 히트맵이 웹페이지 전체 폭(100%) 차지

   v21: AI 출고 상황 설명 (Mock AI)
   - KPI 숫자 표시를 대체 — 출고 상황을 자연어로 설명하는 AI 패널 추가
   - 로직은 ai_explainer.js로 분리 (규칙 템플릿 + 랜덤 변형)

   v22: 잔존 기준 변경
   - 잔존/해소율 = 출고 시작 시점의 초기 셔플링(shuffleBase) 기준
   - 누적 카운트 제거 — 잔존은 해소할수록 줄어드는 "남은 초기 셔플링"

   v23: AI 4단계 분석 (진단/원인/예측/추천)
   - 진단: 해소 수준 + 전체 완료 예상 시간
   - 원인: G-Lifter 대수/고위험 셀 커버 + 이동 시간 비중
   - 예측: 잔존 셔플링 추가 처리 시간
   - 추천: 셔플링 집중 셀 + G-Lifter 이동 제안
   ========================================================= */
const ZONES = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V'];
const DEPTHS = [1,2,3,4,5];
const BUNDLE_COUNT = 3, BUNDLE_ROWS = 5, BUNDLE_COLS = 22, PER_CELL = 330;
const TIME_DIRECT = 1;              // 일반(Direct) 출고 1건
const TIME_GL_SHUFFLE = 5;          // G-Lifter 셔플링 1건 (이동·인양 포함)
const TIME_HUMAN_SHUFFLE = 10;      // 인간 셔플링 1건 (비교용)
const G_REACH_COLS = 13;            // G-Lifter 커버 윈도우 폭 (5행×13열)
const MAX_DISPATCH = 5000;

// Bundle 실사 배치도: southport.jpeg는 3개 bundle을 좌→우로 보여주는 템플릿이다.
// Excel의 bundle(1~3), row(1~5), column(1~22)를 이미지 좌표에 매핑한다.
const BUNDLE_IMAGE_URL = new URL('./southport.jpeg', import.meta.url).href;
const BUNDLE_IMAGE_W = 1160, BUNDLE_IMAGE_H = 924;
// 사진의 3개 bundle 영역. 각 영역은 촬영 각도에 맞춰 4점으로 잡는다.
// Excel의 row(가로 5칸) × column(세로 22칸)을 이 사각형에 bilinear mapping한다.
const BUNDLE_QUADS = [
  {tl:[30,18],  tr:[347,16],  br:[386,900], bl:[75,923]},
  {tl:[398,12], tr:[682,10],  br:[716,879], bl:[428,892]},
  {tl:[763,10], tr:[1088,10], br:[1112,849], bl:[801,863]}
];
let selectedCellId: string | null = null;

let cells: any[] = [];
let plateIndex: any = {};   // 번호판(정규화) → {cell, bundle, car}
let events: any[] = [];
let timeline: any[] = [];             // G-Lifter 이동 타임라인
let severityRank: any = {};         // cell_id → 심각도 순위 (작을수록 심각)
let glifterState: any[] = [];         // {id, rankIdx, cell} — G-Lifter 현재 위치
// 위성 뷰(southportView)용 상태 노출
(window as any).__yard = { cells: ()=>cells, glifterState: ()=>glifterState };
let simDone = false, yardLoaded = false;
let logEl = $('log');
function addLog(m){ logEl.innerHTML += '<div>&gt; ' + m + '</div>'; logEl.scrollTop = logEl.scrollHeight; }
function glifterCount(){ return Math.min(110, Math.max(1, parseInt($('glifter-count').value)||3)); }

// 잠재 해소율: 배치된 G-Lifter가 커버하는 셔플링 차량 비율 (G-Lifter 대수 최적화 지표)
function potentialRate(){
  const total = cells.reduce((s,c)=>s+c.shuffleCount,0);
  const covered = cells.reduce((s,c)=>s+(c.hasG ? c.shuffleCount : 0),0);
  return total > 0 ? Math.round(covered/total*100) : 0;
}

// R5: 셀 위험도 — 셔플링 차량 수 기준 3분위 (상위 33% HIGH / 중위 33% MID / 하위 34% OK)
function updateRisks(){
  const sorted = cells.map(c=>c.shuffleCount).sort((a,b)=>a-b);
  const n = sorted.length;
  const highThr = sorted[Math.floor(n*0.67)];
  const midThr = sorted[Math.floor(n*0.34)];
  cells.forEach(c=> c.risk = c.shuffleCount >= highThr ? 'HIGH' : (c.shuffleCount >= midThr ? 'MID' : 'OK'));
}
function pad(n){ return String(n).padStart(2,'0'); }
function timeStr(t){ return pad(Math.floor(t/60)) + ':' + pad(t%60); }
function normPlate(p){ return String(p||'').replace(/\s+/g,'').toUpperCase(); }

function buildYardFromRows(rows){
  cells = [];
  ZONES.forEach(zone=>{ DEPTHS.forEach(depth=>{
    const cell: any = {id:zone+depth, zone, depth, bundles:[], cars:[], dispatched:0, shuffled:0, direct:0, resolvedS:0, pendingS:0, hadDispatch:false, resolved:false, pending:false};
    for(let bi=0; bi<BUNDLE_COUNT; bi++){
      const bundle: any = [];
      for(let r=1; r<=BUNDLE_ROWS; r++){
        for(let col=1; col<=BUNDLE_COLS; col++){
          bundle.push({bl:'', plateNo:'', model:'', mfr:'', mto:'MTS', pio:'N', shuffle:false, row:r, column:col, bundle:bi+1, pos:(r-1)*BUNDLE_COLS+col, removed:false, blocking:false, target:false});
        }
      }
      bundle.blockers = 0; bundle.blockedLane = 0; bundle.target = null;
      cell.bundles.push(bundle);
    }
    cell.cars = cell.bundles.flat();
    cell.updateStats = function(){
      this.shuffleCount = this.bundles.reduce((s,l)=>s+l.filter(c=>!c.removed && c.shuffle).length,0);
      this.blockers = this.bundles.reduce((s,l)=>s+l.blockers,0);
      this.blockedLanes = this.bundles.reduce((s,l)=>s+(l.blockedLane?1:0),0);
      this.aliveCount = this.bundles.reduce((s,l)=>s+l.filter(c=>!c.removed).length,0);
    };
    cell.updateStats();
    cells.push(cell);
  }); });

  let loaded = 0;
  rows.forEach(row=>{
    const cellId = String(row.cell_id||'').trim();
    const bundleId = parseInt(row.bundle);
    const linPos = (parseInt(row.row) - 1) * BUNDLE_COLS + parseInt(row.column);
    if(!cellId || !bundleId || !linPos) return;
    const cell = cells.find(c=>c.id===cellId);
    if(!cell) return;
    const b = cell.bundles[bundleId-1]; if(!b) return;
    const car = b[linPos-1]; if(!car) return;
    car.bl = String(row.bl_no||'').trim();
    car.plateNo = String(row.plate_no||'').trim();
    car.model = String(row.model||'').trim();
    car.mfr = String(row.mfr||'').trim();
    car.mto = String(row.order_type||'MTS').trim() || 'MTS';
    car.pio = String(row.pio_flag||'N').trim() || 'N';
    car.shuffle = String(row.shuffle_yn||'N').trim().toUpperCase() === 'Y';
    if(car.bl || car.plateNo) loaded++;
  });

  cells.forEach(cell=>{
    cell.bundles.forEach(bundle=> calcBundle(bundle));
    cell.updateStats();
  });
  updateRisks();   // R5: 셔플링 차량 수 3분위 위험도 (G-Lifter 배치 전에 산출)
  buildSeverityRank();

  // 번호판 인덱스 구축 (O(1) 매칭용)
  plateIndex = {};
  cells.forEach(cell=>{
    cell.bundles.forEach(bundle=>{
      bundle.forEach(car=>{
        if(car.plateNo){
          const key = normPlate(car.plateNo);
          if(!plateIndex[key]) plateIndex[key] = {cell, bundle, car};
        }
      });
    });
  });

  applyGlifters();   // R3: 고위험(3분위 HIGH) 상위 3셀에 G-Lifter 배치
  return loaded;
}

// R1: bundle 상태 — 셔플링 차량(shuffle_yn=Y) 집계
function calcBundle(bundle){
  const alive = bundle.filter(c=>!c.removed);
  alive.forEach((c,i)=> c.pos = i+1);
  bundle.blockers = alive.filter(c=>c.shuffle).length;
  bundle.blockedLane = bundle.blockers > 0 ? 1 : 0;
  bundle.target = null;
  alive.forEach(c=>{ c.blocking=false; c.target=false; });
}

function applyGlifters(){
  cells.forEach(c=> c.hasG = false);
  // G-Lifter 배치: 위험도가 가장 심한 셀부터 상위 N곳을 해소 대상으로 지정
  // - 화면의 셀 배치는 그대로 유지 (정렬은 배치 선정에만 사용)
  // - 우선순위: HIGH > MID > OK, 동일 등급 내 셔플링 차량 수 많은 셀 우선
  const riskRank = {HIGH:0, MID:1, OK:2};
  const mostSevere = [...cells].sort((a,b)=>{
    if(riskRank[a.risk] !== riskRank[b.risk]) return riskRank[a.risk] - riskRank[b.risk];
    return b.blockers - a.blockers;
  });
  mostSevere.slice(0, glifterCount()).forEach(c=> c.hasG = true);
}

// 위험도 순위: HIGH(빨강) > MID > OK, 동일 등급 내 셔플링 차량 수 많은 순 (rank 작을수록 우선 방문)
function buildSeverityRank(){
  severityRank = {};
  const riskRank = {HIGH:0, MID:1, OK:2};
  [...cells].sort((a,b)=>{
    if(riskRank[a.risk] !== riskRank[b.risk]) return riskRank[a.risk] - riskRank[b.risk];
    return b.shuffleCount - a.shuffleCount;
  }).forEach((c,i)=> severityRank[c.id] = i);
}

// 출고 실행 시: G-Lifter N대를 위험도 최상위 셀부터 배치 (셀당 1대)
// 이후 커버 구역(5×13열)에서 해소 후 다음 구역으로 직진 이동만 가능
function initGlifters(){
  glifterState = [];
  [...cells].sort((a,b)=> severityRank[a.id]-severityRank[b.id]).slice(0, glifterCount())
    .forEach((c,i)=> glifterState.push({id:'GL-' + String(i+1).padStart(2,'0'), rankIdx: severityRank[c.id], cell: c.id, path:[c.id], moves:0}));
}

// 사이드바 G-Lifter 이동 현황 대시보드
function renderGlifterBoard(){
  const el = $('gl-board');
  if(!glifterState.length){
    el.innerHTML = '<b>🚚 G-Lifter 이동 현황:</b> 출고 실행 후 표시됩니다.';
    return;
  }
  const lines = glifterState.map(g=>{
    return '<div><b>' + g.id + '</b> · 현재 <b>' + g.cell + '</b> · 이동 ' + g.moves + '회<br/>' +
      '<span class="note">경로: ' + g.path.join(' → ') + '</span></div>';
  });
  el.innerHTML = '<b>🚚 G-Lifter 이동 현황 (' + glifterState.length + '대):</b><br/>' + lines.join('<br/>');
}

function renderTimeline(){
  const evs = timeline.filter(ev=> ev.type === 'MOVE' || (ev.type === 'SHUFFLE' && ev.result === 'RESOLVED'));
  const row = (ev: any)=> ev.type === 'MOVE'
    ? '<tr class="hover:bg-surface-container-low transition-colors"><td class="px-4 py-2 text-xs text-on-surface-variant">' + Math.round(ev.min) + '분</td><td class="px-4 py-2"><span class="bg-surface-variant text-primary-container px-2 py-0.5 rounded text-xs font-medium">' + ev.gl + '</span></td><td class="px-4 py-2">셔플링 이동</td><td class="px-4 py-2 font-mono text-xs">' + ev.from + '</td><td class="px-4 py-2 font-mono text-xs">' + ev.to + '</td><td class="px-4 py-2"><span class="text-status-success font-medium"><i class="ri-checkbox-circle-line"></i> 완료</span></td></tr>'
    : '<tr class="hover:bg-surface-container-low transition-colors"><td class="px-4 py-2 text-xs text-on-surface-variant">' + Math.round(ev.min) + '분</td><td class="px-4 py-2"><span class="bg-surface-variant text-primary-container px-2 py-0.5 rounded text-xs font-medium">' + ev.gl + '</span></td><td class="px-4 py-2">셔플링 해소</td><td class="px-4 py-2 font-mono text-xs">' + ev.cell + '</td><td class="px-4 py-2 font-mono text-xs">-</td><td class="px-4 py-2"><span class="text-status-success font-medium"><i class="ri-checkbox-circle-line"></i> 해소</span></td></tr>';
  const recent = evs.slice(-50).map(row).join('');
  const all = evs.map(row).join('');
  $('gl-timeline').innerHTML = recent || '<tr><td colspan="6" class="px-4 py-3 text-center text-xs text-on-surface-variant">출고 실행 후 표시됩니다</td></tr>';
  $('gl-timeline-full').innerHTML = all || '<tr><td colspan="6" class="px-6 py-3 text-center text-xs text-on-surface-variant">이동 기록이 없습니다</td></tr>';
  $('gl-timeline-count').textContent = evs.length;
}

let beforeRiskMap = {}, beforeShuffleMap = {}, beforeBlockCountMap = {}, beforeCountMap = {};
let lastLoaded = 0, mtoRate = 0;

function loadYardFile(file){
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const wb = XLSX.read(new Uint8Array(e.target.result as ArrayBuffer), {type:'array'});
      const ws = wb.Sheets[wb.SheetNames.includes('MASTER_차량') ? 'MASTER_차량' : wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, {defval:''});
      const loaded = buildYardFromRows(raw);
      if(loaded === 0){ addLog('[오류] 유효한 차량 행이 없습니다.'); return; }
      yardLoaded = true; simDone = false; events = [];
      beforeRiskMap = {}; beforeShuffleMap = {}; beforeBlockCountMap = {}; beforeCountMap = {};
      cells.forEach(c=>{
        beforeRiskMap[c.id]=c.risk; beforeShuffleMap[c.id]=c.shuffleCount;
        beforeBlockCountMap[c.id]=c.blockers; beforeCountMap[c.id]=c.aliveCount;
      });
      lastLoaded = loaded;
      const allCars = cells.flatMap((c:any)=> c.bundles.flat());
      const mtoCnt = allCars.filter((c:any)=> c.mto==='MTO').length;
      mtoRate = Math.round(mtoCnt / Math.max(1, allCars.length) * 1000) / 10;
      $('data-badge').textContent = '야드 ' + loaded.toLocaleString() + '대 로드';
      $('data-badge').className = 'flex items-center gap-2 bg-green-50 text-status-success rounded-full text-xs font-medium border border-green-100 px-3 py-1.5';
      $('yard-info').innerHTML = '<b>' + file.name + '</b><br/>차량 ' + loaded.toLocaleString() + '대 로드 완료';
      $('kpi-incoming').textContent = loaded.toLocaleString('ko-KR');
      $('kpi-mto').textContent = mtoRate;
      $('kpi-high').textContent = cells.filter(c=>c.risk==='HIGH').length;
      resetOutputs();
      drawHeatmaps();
      addLog('[야드] ' + file.name + ' 로드 · 차량 ' + loaded.toLocaleString() + '대 · 고위험 셀 ' + cells.filter(c=>c.risk==='HIGH').length + '개');
      addLog('[G-Lifter 배치] 위험도 최상위 셀: ' + cells.filter(c=>c.hasG).map(c=>c.id).join(', ') + ' · ' + glifterCount() + '대 → 잠재 해소율 ' + potentialRate() + '%');
    } catch(err){
      console.error(err);
      addLog('[오류] 엑셀 파싱 실패: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function resetOutputs(){
  resetSatelliteCache();   // 위성 뷰 캐시 리셋
  historyStack = [];
  all$('btn-undo').forEach((b: any)=> b.disabled = true);
  setW('ai-progress', '0%');
  setT('ai-progress-label', '0%');
  setT('ai-resolved', 0);
  setT('ai-pending', 0);
  setT('ai-direct', 0);
  setT('ai-moves', 0);
  setT('ai-resolved-bar', 0);
  setT('ai-resolved-bar2', 0);
  setT('ai-shuffle-total', 0);
  setT('ai-pending-bar', 0);
  setW('prog-direct', '0%');
  setT('kpi-direct-rate', '0%');
  setT('kpi-direct-rate2', '0%');
  setT('kpi-saved', 0);
  setT('kpi-compare', '—');
  setT('ai-diagnosis', '—');
  setT('ai-cell-analysis', '—');
  setT('ai-prediction', '—');
  setT('ai-recommendation', '—');
  setT('verdict-text', '');
  setH('cell-result-log', '셀별 해소 결과: 출고 실행 후 표시됩니다.');
  setH('gl-board', 'G-Lifter 이동 현황: 출고 실행 후 표시됩니다.');
  setH('gl-timeline', '<tr><td colspan="6" class="px-4 py-3 text-center text-xs text-on-surface-variant">출고 실행 후 표시됩니다</td></tr>');
  setH('gl-timeline-full', '');
  setT('gl-timeline-count', 0);
}

let isRunning = false;
let stepState: any = null;
let historyStack: any[] = [];   // 출고 단계 되돌리기용 스냅샷 스택

// 현재 상태 스냅샷 저장 (단계 진행 전 호출)
function saveSnapshot(){
  const cars = cells.flatMap((c: any)=> c.bundles.flat());
  historyStack.push({
    removed: cars.map((car: any)=> car.removed),
    cells: cells.map(c=>({
      dispatched:c.dispatched, shuffled:c.shuffled, direct:c.direct,
      resolvedS:c.resolvedS, pendingS:c.pendingS,
      hadDispatch:c.hadDispatch, resolved:c.resolved, pending:c.pending
    })),
    glifter: glifterState.map(g=>({id:g.id, rankIdx:g.rankIdx, cell:g.cell, path:[...g.path], moves:g.moves})),
    eventsLen: events.length,
    timelineLen: timeline.length,
    st: stepState ? {...stepState, unmatchedList:[...stepState.unmatchedList]} : null
  });
  if(historyStack.length > 60) historyStack.shift();
  all$('btn-undo').forEach((b: any)=> b.disabled = historyStack.length === 0);
}

// 이전 단계로 되돌리기 (출고 되돌리기)
function undoStep(){
  const snap = historyStack.pop();
  all$('btn-undo').forEach((b: any)=> b.disabled = historyStack.length === 0);
  if(!snap){ addLog('[오류] 되돌릴 단계가 없습니다.'); return; }
  const cars = cells.flatMap((c: any)=> c.bundles.flat());
  cars.forEach((car: any, i: number)=>{ car.removed = snap.removed[i]; });
  cells.forEach((c: any, i: number)=>{ Object.assign(c, snap.cells[i]); });
  glifterState = snap.glifter.map((g: any)=>({...g, path:[...g.path]}));
  events = events.slice(0, snap.eventsLen);
  timeline = timeline.slice(0, snap.timelineLen);
  stepState = snap.st;
  cells.forEach((c: any)=>{ c.bundles.forEach((b: any)=> calcBundle(b)); c.updateStats(); });
  simDone = false;
  if(stepState && stepState.idx < stepState.plates.length) setRunning(true);
  else setRunning(false);
  updateAI();
  drawHeatmaps();
  renderTimeline();
  renderGlifterBoard();
  $('sim-progress').textContent = '↩️ 되돌림 · ' + (stepState ? stepState.idx : 0) + '/' + (stepState ? stepState.plates.length : 0) + '대 · 경과 ' + (stepState ? Math.round(stepState.t) : 0) + '분';
  addLog('[출고 되돌리기] 이전 단계 상태로 복원했습니다.');
}

function setRunning(run){
  isRunning = run;
  all$('btn-export').forEach((b: any)=> b.disabled = run);
  all$('btn-reset').forEach((b: any)=> b.disabled = run);
  const label = run ? '⏭️ 분석 진행' : (simDone ? '✅ 분석 완료' : '분석 시작');
  all$('btn-run').forEach((b: any)=> b.textContent = label);
}

function runDispatch(){
  if(!yardLoaded){ addLog('[오류] 야드 엑셀을 먼저 업로드하세요.'); return; }
  if(isRunning) return;
  const ta = $('plate-input').value;
  const list = [];
  ta.split(/\r?\n/).forEach(l=>{ l=l.trim(); if(l) list.push(l); });
  if(list.length === 0){ addLog('[오류] 빼고 싶은 차량 번호판을 입력하세요.'); return; }
  const plates = list.slice(0, MAX_DISPATCH);

  events = [];
  timeline = [];
  cells.forEach(c=>{ c.dispatched=0; c.shuffled=0; c.direct=0; c.resolvedS=0; c.pendingS=0; c.hadDispatch=false; c.resolved=false; c.pending=false; });
  initGlifters();

  // 지시 전처리: 중복 플레이트만 배제 — 원래(업로드) 순서 유지
  // → 셔플링 지시가 전체 진행에 분산되어 클릭 단위로 점진 해소
  const orderedPlates: string[] = [];
  const seenPlates = new Set<string>();
  let dispatchShuffle = 0;
  plates.forEach(p=>{
    const key = normPlate(p);
    if(seenPlates.has(key)) return;          // 중복 배제
    seenPlates.add(key);
    orderedPlates.push(p);
    const f = plateIndex[key];
    if(f && !f.car.removed && f.car.shuffle) dispatchShuffle++;
  });

  stepState = {plates: orderedPlates, idx:0, seq:0, t:0, matched:0, unmatched:0, unmatchedList:[], dispatchShuffle, dispatchedResolved: 0};

  setRunning(true);
  drawHeatmaps();
  $('sim-progress').textContent = '출고 실행 중... 0/' + plates.length + '대 · 경과 0분';
  addLog('[출고 실행] 단계별 시뮬레이션 시작: ' + plates.length + '대 지시 · 버튼 클릭마다 1단계 진행');
  stepTick();
}

// AI 분석용 상태 수집 (동기)
function collectAIState(){
  const st = stepState;
  const directCount = cells.reduce((s,c)=>s+c.direct,0);
  const physicalResolved = cells.reduce((s,c)=>s+c.resolvedS,0);        // 물리적 전수 해소 건수 (KPI 표시용)
  // 해소율 = 지시된 셔플링 중 해소 완료 / 지시된 셔플링 (분모 = 업로드 목록 중 행3 셔플링)
  const dispatchShuffle = st ? st.dispatchShuffle : cells.reduce((s,c)=>s+c.shuffleCount,0);
  const dispatchedResolved = st ? st.dispatchedResolved : 0;
  const pending = Math.max(0, dispatchShuffle - dispatchedResolved);
  const rate = dispatchShuffle > 0 ? Math.round(dispatchedResolved / dispatchShuffle * 100) : 0;
  const moves = timeline.filter(e=>e.type==='MOVE').length;
  return {
    dispatch: st ? st.plates.length : 0,
    matched: st ? st.matched : 0,
    progress: st ? st.idx : 0,
    t: st ? st.t : 0,
    finished: !st || simDone || st.idx >= st.plates.length,   // 셔플링 전수 해소로 조기 종료 시에도 완료 처리
    direct: directCount,
    shuffleTotal: dispatchShuffle,
    resolved: dispatchedResolved,
    physicalResolved: physicalResolved,
    pending: pending,
    rate: rate,
    riskHigh: cells.filter(c=>c.risk==='HIGH').length,
    moves: moves,
    glifterState: glifterState,
    humanPending: cells.reduce((s,c)=>s+c.pendingS,0),   // 잔존(인간 처리 대상) 건수
    humanMin: st ? directCount * TIME_DIRECT + dispatchShuffle * TIME_HUMAN_SHUFFLE : 0,
    savedMin: st ? Math.max(0, (directCount * TIME_DIRECT + dispatchShuffle * TIME_HUMAN_SHUFFLE) - Math.round(st.t)) : 0,
    topShuffle: cells.filter(c=>c.shuffleCount>0).sort((a,b)=>b.shuffleCount-a.shuffleCount).slice(0,3).map(c=>({
      id: c.id,
      count: c.shuffleCount,
      deepCount: c.bundles.flat().filter((x: any)=> !x.removed && x.shuffle && x.row===3).length
    }))
  };
}

// AI 분석 갱신 (단계 진행 중에도 버튼 클릭마다 반영)
async function updateAI(){
  const state = collectAIState();
  const st = stepState;
  // 해소 진척도 (진행 바 + 라벨)
  setW('ai-progress', state.rate + '%');
  setT('ai-progress-label', state.rate + '%');
  setT('ai-resolved-bar', state.resolved);
  setT('ai-resolved-bar2', state.resolved);
  setT('ai-shuffle-total', state.shuffleTotal);
  setT('ai-pending-bar', state.pending);
  // Direct 출고율
  const directRate = st && st.plates.length > 0 ? Math.round(state.direct / st.plates.length * 100) : 0;
  setW('prog-direct', directRate + '%');
  setT('kpi-direct-rate', directRate + '%');
  setT('kpi-direct-rate2', directRate + '%');
  // KPI 카드
  setT('kpi-incoming', lastLoaded.toLocaleString('ko-KR'));
  setT('kpi-mto', mtoRate);
  setT('kpi-high', state.riskHigh);
  setT('kpi-saved', state.savedMin);
  setT('kpi-compare', st && st.t > 0 ? 'G-Lifter ' + Math.round(st.t) + '분 · 인간 ' + state.humanMin + '분' : '—');
  // AI 브리핑 수치
  setT('ai-resolved', state.resolved);   // 지시된 셔플링 중 해소 건수 (전수 해소 없음)
  setT('ai-pending', state.pending);
  setT('ai-direct', state.direct);
  setT('ai-moves', state.moves);

  const analysis = await AIProvider.analyze(state);   // AI Provider 경유 (mock → 실제 API 전환 용이)
  setT('ai-diagnosis', analysis.diagnosis || '—');
  setT('ai-cell-analysis', analysis.cellAnalysis || '—');
  setT('ai-prediction', analysis.prediction || '—');
  setT('ai-recommendation', analysis.recommendation || '—');
}

// 수동 단계 진행: 버튼 클릭 1회 = 배치 1개 처리 후 <출고 후> 갱신
function stepTick(){
  const st = stepState;
  saveSnapshot();                     // 되돌리기용 스냅샷 (배치 처리 전)
  const batch = parseInt($('sim-speed').value) || 25;
  const end = Math.min(st.idx + batch, st.plates.length);

  for(; st.idx < end; st.idx++){
    const plate = st.plates[st.idx];
    const found = plateIndex[normPlate(plate)];
    if(!found){ st.unmatched++; st.unmatchedList.push(plate); continue; }
    const {cell, bundle, car} = found;
    if(car.removed){
      if(car.shuffle){ st.dispatchedResolved++; cell.resolved = true; }   // G-Lifter가 이미 전수 해소 → 해소로 카운트
      else { st.unmatched++; st.unmatchedList.push(plate + '(이미 출고)'); }
      continue;
    }
    st.matched++; cell.dispatched++; cell.hadDispatch = true;

    if(!car.shuffle){                                 // R2: 셔플링 차량 아님 → Direct Pick-up (즉시 출고)
      cell.direct++;
      st.seq++; st.t += TIME_DIRECT;
      events.push({seq:st.seq, time:timeStr(st.t), cell:cell.id, bundle:car.bundle, vehicle:car.plateNo, action:'DISPATCH', handler:'-', result:'DIRECT_PICKUP', minutes:TIME_DIRECT, note:'셔플링 없이 즉시 출고', shuffleYn:'N'});
      car.removed = true;
      calcBundle(bundle);
    } else {                                          // R1: 셔플링 차량 — G-Lifter가 해당 셀로 이동해 지시 차량 1대 해소 (자유 이동)
      const rank = severityRank[cell.id];
      const g = glifterState[rank % glifterState.length];
      cell.shuffled++;
      if(g.cell !== cell.id){                         // 해당 셀로 이동 (이동 시간은 인양 5분에 포함)
        st.seq++; st.t += 0;
        timeline.push({type:'MOVE', min:st.t, gl:g.id, from:g.cell, to:cell.id});
        events.push({seq:st.seq, time:timeStr(st.t), cell:cell.id, bundle:car.bundle, vehicle:'-', action:'MOVE', handler:g.id, result:'MOVED', minutes:0, note:'셔플링 해소를 위해 셀 이동(시간은 인양 5분에 포함)', shuffleYn:'-'});
        g.cell = cell.id; g.rankIdx = rank;
        g.path.push(cell.id); g.moves++;
      }
      // 지시된 이 차량 1대만 해소 (미지시 셔플링은 야드에 남음)
      st.seq++; st.t += TIME_GL_SHUFFLE;
      timeline.push({type:'SHUFFLE', min:st.t, gl:g.id, cell:cell.id, result:'RESOLVED'});
      events.push({seq:st.seq, time:timeStr(st.t), cell:cell.id, bundle:car.bundle, vehicle:car.plateNo, action:'SHUFFLE', handler:g.id, result:'RESOLVED', minutes:TIME_GL_SHUFFLE, note:'G-Lifter가 인양(5분) → 셔플링 해소', shuffleYn:'Y'});
      cell.resolvedS++;
      car.removed = true;
      cell.resolved = true;
      st.dispatchedResolved++;
      calcBundle(bundle);
    }
  }

  cells.forEach(c=> c.updateStats());
  updateAI();                                         // 단계 진행 시 AI 설명도 함께 갱신
  drawHeatmaps();
  renderTimeline();
  renderGlifterBoard();
  if(st.dispatchedResolved >= st.dispatchShuffle && st.dispatchShuffle > 0){
    finishDispatch();                                 // 지시 셔플링 전부 해소 → 작업 종료
  } else if(st.idx < st.plates.length){
    $('sim-progress').textContent = '진행 ' + st.idx + '/' + st.plates.length + '대 · 경과 ' + Math.round(st.t) + '분 · ⏭️ 버튼을 눌러 다음 단계';
  } else {
    finishDispatch();
  }
}

// 셀 완전 청소는 제거됨 — G-Lifter는 지시된 셔플링 차량만 1대씩 해소 (전수 해소 금지)

function finishDispatch(){
  const st = stepState;
  simDone = true;                                     // 완료 플래그를 먼저 설정 (조기 종료 포함)
  const state = collectAIState();                     // 동기 상태 수집 (updateAI는 async)
  updateAI();                                         // AI 텍스트 갱신 (비동기, 완료 대기 없음)
  const rate = state.rate, shuffleTotal = state.shuffleTotal, resolvedShuffleTotal = state.resolved, directCount = state.direct;
  const dispatchedCells = cells.filter(c=>c.hadDispatch);
  // 시간 비교: G-Lifter(5분/건) vs 인간(10분/건)
  const humanTotal = directCount * TIME_DIRECT + shuffleTotal * TIME_HUMAN_SHUFFLE;
  const savedMin = Math.max(0, humanTotal - Math.round(st.t));

  const verdict = $('verdict-text');
  if(shuffleTotal === 0){
    verdict.textContent = '업로드 목록에 셔플링 차량이 없어 해소율을 판단할 수 없습니다.';
  } else if(rate === 100){
    verdict.innerHTML = '지시 셔플링 <b>' + shuffleTotal + '건 전부</b> <span class="resolved">✅ 해소</span>되었습니다.<br/>→ G-Lifter 배치가 <b>출고 셔플링을 완전히 해소</b>했습니다.';
  } else if(rate >= 50){
    verdict.innerHTML = '지시 셔플링 <b>' + shuffleTotal + '건</b> 중 <b>' + resolvedShuffleTotal + '건 해소</b> (해소율 ' + rate + '%).<br/>→ 잔존 <b>' + state.pending + '건</b> · G-Lifter 대수 확대 시 효율 증가.';
  } else {
    verdict.innerHTML = '지시 셔플링 <b>' + shuffleTotal + '건</b> 중 해소 <b>' + resolvedShuffleTotal + '건</b> (' + rate + '%).<br/>→ 잔존 <b>' + state.pending + '건</b> · G-Lifter 배치 확대가 필요한 상태.';
  }

  const cellLog = $('cell-result-log');
  if(dispatchedCells.length > 0){
    const lines = dispatchedCells.map(c=>{
      const status = c.resolved ? '<span class="resolved">✅ 해소</span>' : (c.pending ? '<span class="pending">🚧 잔존</span>' : '<span>출고만 발생</span>');
      return c.id + ': 출고 ' + c.dispatched + '대 · 직접 ' + c.direct + '대 · 셔플링 ' + c.shuffled + '건 · 해소 ' + c.resolvedS + '건 → ' + status;
    });
    cellLog.innerHTML = '<b>셀별 해소 결과 (' + lines.length + '개):</b><br/>' + lines.join('<br/>');
  } else {
    cellLog.innerHTML = '<b>셀별 해소 결과:</b> 출고 발생 셀 없음';
  }

  drawHeatmaps();
  renderTimeline();
  renderGlifterBoard();
  const endByShuffle = st.dispatchShuffle > 0 && st.dispatchedResolved >= st.dispatchShuffle && st.idx < st.plates.length;
  $('sim-progress').textContent = '✅ 완료' + (endByShuffle ? '(셔플링 전수 해소)' : '') + ' · 지시 ' + st.plates.length + '대 · 경과 ' + Math.round(st.t) + '분 · 해소율 ' + rate + '%';
  addLog('[출고 실행] 지시 ' + st.plates.length + '대 · 매칭 ' + st.matched + ' · 실패 ' + st.unmatched + ' · Direct Pick-up ' + directCount + '대' + (endByShuffle ? ' · 셔플링 완료로 조기 종료' : ''));
  addLog('[시간 비교] G-Lifter 소요 ' + Math.round(st.t) + '분 · 인간(셔플링 ' + shuffleTotal + '건) 동일 처리 시 ' + humanTotal + '분 → ' + savedMin + '분 절약');
  addLog('[G-Lifter 이동] 이동 ' + timeline.filter(e=>e.type==='MOVE').length + '회 · 최종 위치: ' + glifterState.map(g=>g.id+'@'+g.cell).join(', '));
  addLog('[셔플링 결과] 지시 셔플링 ' + shuffleTotal + '건 · 해소 ' + resolvedShuffleTotal + '건 · 잔존 ' + state.pending + '건 · 해소율 ' + rate + '%');
  if(st.unmatchedList.length) addLog('[미매칭 번호판] ' + st.unmatchedList.slice(0,20).join(', ') + (st.unmatchedList.length>20 ? ' 외 ' + (st.unmatchedList.length-20) + '개' : ''));
  setRunning(false);
}

function ensureBundleViewer(){
  let viewer = $('bundle-viewer');
  if(viewer) return viewer;

  const anchor = $('heatmap-before') || $('heatmap-after');
  if(!anchor || !anchor.parentElement) return null;

  viewer = document.createElement('div');
  viewer.id = 'bundle-viewer';
  viewer.style.cssText = [
    'display:none', 'margin:16px 0', 'padding:16px', 'border:1px solid #dbe3ef',
    'border-radius:14px', 'background:#f8fafc', 'box-sizing:border-box'
  ].join(';');

  viewer.innerHTML = `
    <div id="bundle-viewer-title" style="font-weight:800;font-size:16px;margin-bottom:10px"></div>
    <div style="position:relative;width:100%;overflow:auto;border-radius:10px;background:#0f172a">
      <div id="bundle-stage" style="position:relative;width:${BUNDLE_IMAGE_W}px;height:${BUNDLE_IMAGE_H}px;transform-origin:top left">
        <img src="${BUNDLE_IMAGE_URL}" alt="Bundle yard layout" draggable="false"
             style="position:absolute;inset:0;width:${BUNDLE_IMAGE_W}px;height:${BUNDLE_IMAGE_H}px;display:block;user-select:none">
        <svg id="bundle-overlay" viewBox="0 0 ${BUNDLE_IMAGE_W} ${BUNDLE_IMAGE_H}"
             width="${BUNDLE_IMAGE_W}" height="${BUNDLE_IMAGE_H}"
             style="position:absolute;inset:0;pointer-events:none"></svg>
      </div>
    </div>
    <div id="bundle-viewer-legend" style="margin-top:9px;font-size:12px;color:#64748b"></div>
  `;

  anchor.parentElement.insertBefore(viewer, anchor);
  return viewer;
}

function slotQuad(quad, row, column){
  // Excel 구조: row=1~5, column=1~22.
  // 사진 구조: 5열 × 22행 → row를 X, column을 Y로 매핑한다.
  const u0 = (row - 1) / 5;
  const u1 = row / 5;
  const v0 = (column - 1) / 22;
  const v1 = column / 22;

  const bilinear = (u, v)=>{
    const [tlx,tly] = quad.tl, [trx,try_] = quad.tr;
    const [brx,bry] = quad.br, [blx,bly] = quad.bl;
    return [
      (1-u)*(1-v)*tlx + u*(1-v)*trx + u*v*brx + (1-u)*v*blx,
      (1-u)*(1-v)*tly + u*(1-v)*try_ + u*v*bry + (1-u)*v*bly
    ];
  };

  const p1 = bilinear(u0,v0), p2 = bilinear(u1,v0);
  const p3 = bilinear(u1,v1), p4 = bilinear(u0,v1);
  return [p1,p2,p3,p4].map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
}

function renderBundleViewer(cellId, mode='before'){
  const viewer = ensureBundleViewer();
  if(!viewer) return;
  const cell = cells.find(c=>c.id===cellId);
  if(!cell) return;
  selectedCellId = cellId;

  viewer.style.display = 'block';
  const title = $('bundle-viewer-title');
  if(title) title.textContent = `${cell.id} · 3 Bundle × 5 Row × 22 Column`;

  const overlay = $('bundle-overlay');
  if(!overlay) return;
  overlay.innerHTML = '';

  const NS = 'http://www.w3.org/2000/svg';
  let alive = 0, empty = 0, removed = 0, shuffle = 0;

  cell.bundles.forEach((bundle, bi)=>{
    const quad = BUNDLE_QUADS[bi];
    bundle.forEach(car=>{
      if(car.empty || (!car.plateNo && !car.bl)) empty++;
      else alive++;
      if(car.removed) removed++;
      if(car.shuffle) shuffle++;

      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', slotQuad(quad, car.row, car.column));
      poly.setAttribute('fill', car.removed ? 'rgba(15,23,42,0.62)' :
        car.shuffle ? 'rgba(249,115,22,0.38)' :
        (car.empty || (!car.plateNo && !car.bl)) ? 'rgba(148,163,184,0.20)' : 'rgba(59,130,246,0.04)');
      poly.setAttribute('stroke', car.shuffle && !car.removed ? '#f97316' :
        car.removed ? '#334155' : 'rgba(255,255,255,0.12)');
      poly.setAttribute('stroke-width', car.shuffle || car.removed ? '2' : '0.5');
      poly.style.pointerEvents = 'all';
      poly.style.cursor = 'pointer';

      const tip = document.createElementNS(NS, 'title');
      const plate = car.plateNo || '(공차/빈 슬롯)';
      tip.textContent = `Bundle ${bi+1} · Row ${car.row} · Column ${car.column}\n번호판: ${plate}\nBL: ${car.bl || '-'}\n차종: ${car.model || '-'}\n셔플링: ${car.shuffle ? 'Y' : 'N'}${car.removed ? '\n출고됨' : ''}`;
      poly.appendChild(tip);
      overlay.appendChild(poly);
    });
  });

  const legend = $('bundle-viewer-legend');
  if(legend){
    legend.innerHTML = `🟧 셔플링 ${shuffle}대 · ⬛ 출고 ${removed}대 · 🚗 차량 ${alive}대 · ◻ 공차/빈 슬롯 ${empty}대`;
  }
}

function hideBundleViewer(){
  const viewer = $('bundle-viewer');
  if(viewer) viewer.style.display = 'none';
  selectedCellId = null;
}

function drawHeatmap(svgId, mode){
  const svg = $(svgId);
  svg.innerHTML = '';
  const W = 940, H = 340, padL = 40, padT = 36, gap = 3, aisleH = 16;
  const cellW = (W - padL - 8) / 22;
  const totalRowH = H - padT - 12 - (DEPTHS.length-1)*aisleH;
  const cellH = totalRowH / 5;

  ZONES.forEach((z,ci)=>{
    const x = padL + ci*cellW + cellW/2;
    const t = el('text');
    t.setAttribute('x',x); t.setAttribute('y',22); t.setAttribute('text-anchor','middle'); t.setAttribute('class','hm-axis');
    t.textContent = z; svg.appendChild(t);
  });
  const rowY = [];
  DEPTHS.forEach((d,ri)=>{
    const y = padT + ri*(cellH+aisleH); rowY.push(y);
    const t = el('text');
    t.setAttribute('x',padL-8); t.setAttribute('y',y+cellH/2+4); t.setAttribute('text-anchor','end'); t.setAttribute('class','hm-axis');
    t.textContent = 'D'+d; svg.appendChild(t);
  });

  const fillMap = {HIGH:'#fca5a5', MID:'#fdba74', OK:'#fde68a'};
  cells.forEach(cell=>{
    const risk = mode==='after' ? cell.risk : (beforeRiskMap[cell.id] || cell.risk);
    const shuffleCount = mode==='after' ? cell.shuffleCount : (beforeShuffleMap[cell.id] || cell.shuffleCount);
    const aliveCount = mode==='after' ? cell.aliveCount : (beforeCountMap[cell.id] || cell.aliveCount);
    const ci = ZONES.indexOf(cell.zone), ri = DEPTHS.indexOf(cell.depth);
    const y = rowY[ri], x = padL + ci*cellW + gap/2, w = cellW - gap, h = cellH - gap;
    const rect = el('rect');
    rect.setAttribute('x',x); rect.setAttribute('y',y); rect.setAttribute('width',w); rect.setAttribute('height',h);
    rect.setAttribute('rx',5); rect.setAttribute('fill', fillMap[risk]);
    // <출고 후>에서 G-Lifter로 해소된 셀만 파란 테두리 (출고 전은 테두리 없음)
    const resolvedCell = mode==='after' && cell.resolved;
    rect.setAttribute('stroke', resolvedCell ? '#1e40af' : '#fff');
    rect.setAttribute('stroke-width', resolvedCell ? 3 : 1.2);
    svg.appendChild(rect);
    rect.style.cursor = 'pointer';
    rect.addEventListener('click', ()=> renderBundleViewer(cell.id, mode));

    const t1 = el('text');
    t1.setAttribute('x',x+w/2); t1.setAttribute('y',y+h/2-9); t1.setAttribute('text-anchor','middle'); t1.setAttribute('class','hm-text');
    t1.textContent = cell.id; svg.appendChild(t1);
    const t2 = el('text');
    t2.setAttribute('x',x+w/2); t2.setAttribute('y',y+h/2+3); t2.setAttribute('text-anchor','middle'); t2.setAttribute('class','hm-sub');
    t2.textContent = '셔플 ' + shuffleCount + '대';
    t2.setAttribute('fill', shuffleCount>0 ? (risk==='HIGH'?'#dc2626':'#c2410c') : '#2e7d32');
    svg.appendChild(t2);
    const t3 = el('text');
    t3.setAttribute('x',x+w/2); t3.setAttribute('y',y+h/2+14); t3.setAttribute('text-anchor','middle'); t3.setAttribute('class','hm-sub');
    t3.textContent = '차량 ' + aliveCount + '대' + (mode==='after' && cell.hadDispatch ? ' · 출고 ' + cell.dispatched : '');
    t3.setAttribute('fill', mode==='after' && cell.hadDispatch ? '#1e40af' : '#64748b');
    t3.setAttribute('font-weight', mode==='after' && cell.hadDispatch ? '700' : '400');
    svg.appendChild(t3);
  });

  const cellCenter = cell=>{
    const ci = ZONES.indexOf(cell.zone), ri = DEPTHS.indexOf(cell.depth);
    return [padL + ci*cellW + cellW/2, rowY[ri] + cellH/2];
  };

  if(mode === 'after' && glifterState.length){
    // G-Lifter 이동 경로 (전진 이동 대시보드 표시)
    glifterState.forEach(g=>{
      if(g.path.length > 1){
        const pts = g.path.map(id=> cellCenter(cells.find(c=>c.id===id)));
        const pl = el('polyline');
        pl.setAttribute('points', pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' '));
        pl.setAttribute('fill','none'); pl.setAttribute('stroke','#f59e0b');
        pl.setAttribute('stroke-width',2); pl.setAttribute('stroke-dasharray','4,3'); pl.setAttribute('opacity',0.85);
        svg.appendChild(pl);
        g.path.forEach((id, pi)=>{
          if(pi > 0 && pi < g.path.length - 1){
            const p = cellCenter(cells.find(c=>c.id===id));
            const dot = el('circle');
            dot.setAttribute('cx',p[0]); dot.setAttribute('cy',p[1]); dot.setAttribute('r',3);
            dot.setAttribute('fill','#f59e0b'); dot.setAttribute('opacity',0.6); svg.appendChild(dot);
          }
        });
      }
      const cur = cells.find(c=>c.id===g.cell);
      const [cx, cy] = cellCenter(cur);
      const circ = el('circle');
      circ.setAttribute('cx',cx); circ.setAttribute('cy',cy); circ.setAttribute('r',9);
      circ.setAttribute('fill','#f59e0b'); circ.setAttribute('stroke','#fff'); circ.setAttribute('stroke-width',2.5);
      svg.appendChild(circ);
      const gl = el('text');
      gl.setAttribute('x',cx); gl.setAttribute('y',cy+3); gl.setAttribute('text-anchor','middle');
      gl.setAttribute('font-size','9'); gl.setAttribute('font-weight','800'); gl.setAttribute('fill','#7a4e00');
      gl.textContent = g.id.replace('GL-0','').replace('GL-',''); svg.appendChild(gl);
    });
  } else {
    // 출고 전: 초기 배치 표시
    const gCells = cells.filter(c=>c.hasG);
    gCells.forEach(cell=>{
      const ci = ZONES.indexOf(cell.zone), ri = DEPTHS.indexOf(cell.depth);
      const x = padL + ci*cellW + cellW/2, y = rowY[ri] + cellH + aisleH/2;
      const g = el('circle');
      g.setAttribute('cx',x); g.setAttribute('cy',y); g.setAttribute('r',7); g.setAttribute('fill','#f59e0b');
      g.setAttribute('stroke','#fff'); g.setAttribute('stroke-width',2); svg.appendChild(g);
      const gl = el('text');
      gl.setAttribute('x',x); gl.setAttribute('y',y+3); gl.setAttribute('text-anchor','middle');
      gl.setAttribute('font-size','8'); gl.setAttribute('font-weight','700'); gl.setAttribute('fill','#7a4e00');
      gl.textContent = 'G'; svg.appendChild(gl);
    });
  }
}

// code.html 스타일 div 그리드 히트맵 렌더러
function cellColor(risk: string): string{
  return risk === 'HIGH' ? 'bg-status-alert' : (risk === 'MID' ? 'bg-yellow-400' : 'bg-surface-container-high');
}

// 야드 배치 현황 (A~V × D1~D5, 셀 클릭 → 셀 상세 분석)
function renderYardGrid(){
  const g = $('yard-grid');
  if(!g) return;
  let html = '<div class="flex gap-1.5 pl-8">' + ZONES.map(z=> '<div class="flex-1 text-[10px] text-center text-outline font-bold">' + z + '</div>').join('') + '</div>';
  DEPTHS.forEach(d=>{
    html += '<div class="flex gap-1.5 items-center"><span class="w-6 text-[10px] font-bold text-outline text-right pr-2">D' + d + '</span>';
    ZONES.forEach(z=>{
      const cell = cells.find(c=> c.id === z + d);
      const color = cell ? cellColor(cell.risk) : 'bg-surface-container-high';
      const ring = cell && cell.risk === 'HIGH' ? ' shadow-sm ring-1 ring-status-alert' : '';
      const dot = cell && cell.hasG
        ? '<div class="absolute inset-0 flex items-center justify-center"><div class="w-3 h-3 rounded-full border-2 border-primary-container bg-white shadow-sm flex items-center justify-center"><div class="w-1.5 h-1.5 rounded-full bg-amber-500"></div></div></div>'
        : '';
      html += '<div class="flex-1 h-8 ' + color + ring + ' rounded cursor-pointer hover:opacity-80 transition-opacity relative" onclick="showCellDetails(\'' + z + d + '\')">' + dot + '</div>';
    });
    html += '</div>';
  });
  g.innerHTML = html;
}

// BEFORE/AFTER 위험도 변화 (소형 그리드)
function renderRiskGrid(id: string, mode: string){
  const g = $(id);
  if(!g) return;
  let html = '<div class="flex gap-1 pl-6">' + ZONES.map(z=> '<div class="flex-1 text-[8px] text-center text-outline font-bold">' + z + '</div>').join('') + '</div>';
  DEPTHS.forEach(d=>{
    html += '<div class="flex gap-1 items-center"><span class="w-5 text-[8px] font-bold text-outline">D' + d + '</span>';
    ZONES.forEach(z=>{
      const cell = cells.find(c=> c.id === z + d);
      if(!cell){ html += '<div class="flex-1 h-6 bg-surface-container-high rounded-sm"></div>'; return; }
      const risk = mode === 'before' ? (beforeRiskMap[cell.id] || cell.risk) : cell.risk;
      let color = cellColor(risk);
      if(mode === 'after' && cell.resolved) color = 'bg-status-success';
      html += '<div class="flex-1 h-6 ' + color + ' rounded-sm"></div>';
    });
    html += '</div>';
  });
  g.innerHTML = html;
}

// 셀 상세 분석 (AI 브리핑 전환)
(window as any).__showCellDetails = (cellId: string)=>{
  $('ai-briefing-default').classList.add('hidden');
  $('ai-briefing-detail').classList.remove('hidden');
  $('detail-cell-id').innerText = cellId;
  const cell = cells.find(c=> c.id === cellId);
  if(!cell) return;
  const alive = cell.cars.filter((c: any)=> !c.removed);
  const mto = alive.filter((c: any)=> c.mto === 'MTO').length;
  const mts = alive.filter((c: any)=> c.mto === 'MTS').length;
  const shuffles = alive.filter((c: any)=> c.shuffle).length;
  $('detail-depth').textContent = 'D' + cell.depth + (cell.depth >= 3 ? ' (심부)' : '');
  $('detail-msg').innerHTML = '해당 셀은 MTO/MTS 혼재로 셔플링 차량 ' + shuffles + '대가 출고 경로를 막고 있습니다. G-Lifter 선제 투입이 시급합니다.';
  $('detail-mto').textContent = mto + '대';
  $('detail-mts').textContent = mts + '대';
  $('detail-shuffle').textContent = shuffles + '대';
  $('detail-glifter').textContent = cell.hasG ? '배치됨' : '미배치';
  $('detail-plan').textContent = 'G-Lifter를 해당 셀 상단에 배치하여 셔플링 대상 차량을 수직 인양하여 출고 경로를 즉시 확보해야 합니다.';
};
(window as any).__hideCellDetails = ()=>{
  $('ai-briefing-default').classList.remove('hidden');
  $('ai-briefing-detail').classList.add('hidden');
};

function drawHeatmaps(){
  renderYardGrid();
  renderRiskGrid('grid-before','before');
  renderRiskGrid('grid-after','after');
  drawSatellite('satellite-view','after');   // 위성 매핑 단일 라이브 뷰 (단계 진행에 따라 갱신)
}

function exportCSV(){
  if(isRunning){ addLog('[오류] 출고 실행이 진행 중입니다. 완료 후 내보내기 가능합니다.'); return; }
  if(!simDone){ addLog('[오류] 출고 실행 후 내보내기 가능합니다.'); return; }
  const evRows = [['event_seq','time','cell_id','bundle','plate_no','action','handler','result','minutes','shuffle_yn','note']];
  events.forEach(e=> evRows.push([e.seq,e.time,e.cell,e.bundle,e.vehicle,e.action,e.handler,e.result,e.minutes,e.shuffleYn,e.note]));
  const cellRows = [['cell_id','risk_before','risk_after','shuffle_cars_before','shuffle_cars_after','before_vehicles','after_vehicles','dispatched','direct_pickup','shuffled','result','glifter']];
  cells.forEach(c=>{
    const result = c.hadDispatch ? (c.resolved ? 'RESOLVED' : (c.pending ? 'PENDING' : 'DISPATCH_ONLY')) : '-';
    cellRows.push([c.id, beforeRiskMap[c.id]||c.risk, c.risk, beforeShuffleMap[c.id]||0, c.shuffleCount, beforeCountMap[c.id]||0, c.aliveCount, c.dispatched, c.direct, c.shuffled, result, c.hasG?'Y':'N']);
  });
  const toCsv = (rows: any[][])=> rows.map(r=>r.map(v=>{ if(v===null||v===undefined) return ''; const s=String(v); return /[\",\n]/.test(s)?'\"'+s.replace(/\"/g,'\"\"')+'\"':s; }).join(',')).join('\n');
  const csv = '[셀 해소 결과]\n' + toCsv(cellRows) + '\n\n[이벤트 로그]\n' + toCsv(evRows);
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const fname = 'G-Lifter_분석결과_' + new Date().toISOString().replace(/[-:T]/g,'').slice(0,12) + '.csv';
  // 1) 자동 다운로드 시도 (일부 환경에서는 차단될 수 있음)
  try{
    const a = document.createElement('a');
    a.href = url; a.download = fname; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ document.body.removeChild(a); }, 300);
  }catch(err){ console.error('[CSV 자동 다운로드 실패]', err); }
  // 2) 다운로드 모달 제공 — 직접 링크 클릭 + 미리보기 복사 (차단 환경 대응)
  if($('export-link')){ $('export-link').href = url; $('export-link').setAttribute('download', fname); }
  if($('export-preview')){ ($('export-preview') as HTMLTextAreaElement).value = csv; }
  if($('export-modal')){ $('export-modal').classList.remove('hidden'); }
  addLog('[내보내기] 분석 결과 CSV 생성: ' + fname + ' (' + (cellRows.length-1) + '셀 · 이벤트 ' + events.length + '건)');
}

$('upload-yard-box').addEventListener('click', ()=> $('file-yard').click());
$('file-yard').addEventListener('change', e=>{ if((e.target as HTMLInputElement).files![0]) loadYardFile((e.target as HTMLInputElement).files![0]); });
$('upload-dispatch-box').addEventListener('click', ()=> $('file-dispatch').click());
$('file-dispatch').addEventListener('change', e=>{
  const file = (e.target as HTMLInputElement).files![0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const text = (ev.target as FileReader).result as string;
    const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const header = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const idxPlate = header.indexOf('plate_no');
    const hasHeader = idxPlate >= 0;
    const list = [];
    if(hasHeader){
      lines.slice(1).forEach(line=>{ const parts = line.split(',').map(p=>p.trim()); if(parts[idxPlate]) list.push(parts[idxPlate]); });
    } else {
      lines.forEach(line=>{ if(line) list.push(line); });
    }
    const capped = list.slice(0, MAX_DISPATCH);
    $('plate-input').value = capped.join('\n');
    addLog('[입력] ' + file.name + ' → 번호판 ' + list.length + '개 로드' + (list.length > MAX_DISPATCH ? ' (최대 ' + MAX_DISPATCH + '개 적용)' : ''));
  };
  reader.readAsText(file);
});
// 중복 id(헤더/모달)를 모두 잡는 헬퍼
function all$(id: string): any[] { return Array.from(document.querySelectorAll('[id="' + id + '"]')); }
// null-safe DOM 쓰기 헬퍼 (요소 누락 시 크래시 방지)
function setT(id: string, v: any){ const el = $(id); if(el) el.textContent = v; }
function setW(id: string, v: string){ const el = $(id); if(el) el.style.width = v; }
function setH(id: string, v: any){ const el = $(id); if(el) el.innerHTML = v; }

$('btn-run').addEventListener('click', ()=>{ if(isRunning) stepTick(); else runDispatch(); });
$('btn-undo').addEventListener('click', ()=>{ if(!historyStack.length){ addLog('[오류] 되돌릴 단계가 없습니다.'); return; } undoStep(); });
// 모달 내 중복 버튼에도 동일 핸들러 바인딩
all$('btn-run').forEach(b=> b.addEventListener('click', ()=>{ if(isRunning) stepTick(); else runDispatch(); }));
all$('btn-undo').forEach(b=> b.addEventListener('click', ()=>{ if(!historyStack.length){ addLog('[오류] 되돌릴 단계가 없습니다.'); return; } undoStep(); }));
// 중복 id(상세뷰/운영성과)의 내보내기 버튼 전부에 동일 핸들러 바인딩
all$('btn-export').forEach(b=> b.addEventListener('click', exportCSV));
// CSV 미리보기 복사
$('btn-copy-csv').addEventListener('click', ()=>{
  const prev = $('export-preview') as HTMLTextAreaElement | null;
  if(!prev || !prev.value) return;
  try{
    prev.select();
    prev.setSelectionRange(0, 999999);
    document.execCommand('copy');
    addLog('[복사] CSV 전체를 클립보드에 복사했습니다.');
  }catch(e){
    navigator.clipboard.writeText(prev.value).then(()=> addLog('[복사] CSV 전체를 클립보드에 복사했습니다.')).catch(()=>{});
  }
});
$('glifter-count').addEventListener('change', ()=>{
  if(isRunning){ addLog('[오류] 출고 실행 중에는 G-Lifter 대수를 변경할 수 없습니다.'); return; }
  if(!yardLoaded){ addLog('[오류] G-Lifter 대수를 변경하려면 야드를 먼저 로드하세요.'); return; }
  applyGlifters();   // 대수 변경 → 위험도 최상위 셀에 재배치
  drawHeatmaps();
  addLog('[G-Lifter 재배치] ' + glifterCount() + '대 → ' + cells.filter(c=>c.hasG).map(c=>c.id).join(', ') + ' · 잠재 해소율 ' + potentialRate() + '%');
});
$('btn-reset').addEventListener('click', ()=>{
  if(isRunning){ addLog('[오류] 출고 실행 중에는 초기화할 수 없습니다.'); return; }
  cells = []; plateIndex = {}; events = []; timeline = []; simDone = false; yardLoaded = false;
  $('data-badge').textContent = '시스템 대기';
  $('data-badge').className = 'flex items-center gap-2 bg-green-50 text-status-success rounded-full text-xs font-medium border border-green-100';
  $('yard-info').textContent = '야드 엑셀을 업로드하세요.';
  $('plate-input').value = '';
  resetOutputs();
  $('yard-grid').innerHTML = '';
  $('grid-before').innerHTML = '';
  $('grid-after').innerHTML = '';
  $('satellite-view').innerHTML = '';
  logEl.innerHTML = '';
  addLog('[초기화] 야드 엑셀을 업로드하세요.');
});

// 헤더 시계
setInterval(()=>{
  const el = $('clock');
  if(el){
    const d = new Date();
    el.textContent = d.getHours() + '시 ' + d.getMinutes() + '분 ' + d.getSeconds() + '초';
  }
}, 1000);

addLog('사용법: 1) 야드 마스터 엑셀 업로드 → 2) 빼고 싶은 차량 번호판 CSV 업로드(대량 가능) → 3) 출고 실행 → 셀별 해소 결과 확인');
