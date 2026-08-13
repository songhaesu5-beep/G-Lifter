/* =========================================================
   satelliteView.ts — 위성 사진 기반 야드 매핑 뷰 (v1)

   컨셉: 항공사진(번들 3개) 위에 시뮬레이션의 "대표 셀 3개"를
   일대일로 매핑해 차량 단위로 보여준다.
   - 사진 번들 = 셀 1개 (위험도 상위 3개 셀, 왼쪽부터 심각순)
   - 셀 1개 = 110슬롯 (11행 × 10열, cell.bundles[0]의 110대)
   - 빨강 슬롯 = shuffle_yn=Y (출고 시 G-Lifter 필요)
   - 출고 후: 출고/해소된 차량 슬롯이 공석(어두운 패치)으로 바뀜
   - G-Lifter: 노란 원 마커 + 이동 경로 점선

   [연동 (파일 2개 + 코드 4줄)]
   1) src/assets/satellite_yard.jpg 추가 (아래 아티팩트에서 다운로드)
   2) main.ts 상태 선언부(cells, glifterState 선언 직후)에 1줄:
        (window as any).__yard = { cells: ()=>cells, glifterState: ()=>glifterState };
   3) main.ts import 추가:
        import { drawSatellite, resetSatelliteCache } from './satelliteView';
   4) resetOutputs() 첫 줄에:  resetSatelliteCache();
      drawHeatmaps() 끝에:
        drawSatellite('satellite-before','before');
        drawSatellite('satellite-after','after');
   5) index.html에 아래 두 SVG 추가:
        <svg id="satellite-before" viewBox="0 0 1160 924" style="width:100%;height:auto;background:#0f172a;border-radius:10px"></svg>
        <svg id="satellite-after"  viewBox="0 0 1160 924" style="width:100%;height:auto;background:#0f172a;border-radius:10px"></svg>
   ※ jpg import 타입 오류 시 src/vite-env.d.ts에
      /// <reference types="vite/client" /> 확인
   ========================================================= */
import satImg from './southport.jpeg';

const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const el = (tag: string): any => document.createElementNS(NS, tag);

// 실제 이미지 크기 (southport.jpeg 627×528)
const IMG_W = 627;
const IMG_H = 528;

// 번들 구분선: 원본(1160px) 기준 통로 x≈380, x≈733 → 비율로 변환해 어떤 이미지에도 대응
const AISLE_1 = 380 / 1160;
const AISLE_2 = 733 / 1160;
const BUNDLE_GEOM = [
  { x: 0,       w: AISLE_1 },
  { x: AISLE_1, w: AISLE_2 - AISLE_1 },
  { x: AISLE_2, w: 1 - AISLE_2 }
];
const SLOT_ROWS = 22;    // 세로 22행 (22×5 배열 90도 회전)
const SLOT_COLS = 5;     // 가로 5열

// 대표 셀/슬롯 캐시 — 출고 전(before)에 확정, after에서 동일 참조 유지
let cacheGen = 0;
let watchCache: { gen: number; items: { cell: any; slots: any[] }[] } = { gen: -1, items: [] };

export function resetSatelliteCache(){ cacheGen++; }

function ensureCache(cells: any[]){
  if(watchCache.gen === cacheGen) return;
  const riskRank: any = { HIGH: 0, MID: 1, OK: 2 };
  const ranked = [...cells].filter(c => c.shuffleCount > 0)
    .sort((a, b) => (riskRank[a.risk] - riskRank[b.risk]) || (b.shuffleCount - a.shuffleCount));
  const picks = ranked.slice(0, 3);              // 대표 셀 3개 (번들당 1개)
  if(picks.length < 3){  // 셔플 셀이 3개 미만이면 잔여는 재고 많은 셀로 채움
    [...cells].filter(c => !picks.includes(c))
      .sort((a, b) => b.aliveCount - a.aliveCount)
      .slice(0, 3 - picks.length)
      .forEach(c => picks.push(c));
  }
  watchCache.gen = cacheGen;
  watchCache.items = picks.map(cell => ({
    cell,
    slots: [...cell.bundles[0]]
      .sort((a: any, b: any) => a.pos - b.pos)   // 위치 순서 유지 (셔플링 정렬 제거 → 실제 좌표 표시)
      .slice(0, SLOT_ROWS * SLOT_COLS)
  }));
}

function ensureStyle(){
  if(document.getElementById('sat-style')) return;
  const st = document.createElement('style');
  st.id = 'sat-style';
  st.textContent = '@keyframes satPulse{0%,100%{opacity:1}50%{opacity:.4}}.sat-pulse{animation:satPulse 1.4s ease-in-out infinite}';
  document.head.appendChild(st);
}

export function drawSatellite(svgId: string, mode: 'before' | 'after'){
  const svg = document.getElementById(svgId) as any;
  if(!svg) return;
  svg.innerHTML = '';
  ensureStyle();

  const Y = (window as any).__yard || {};
  const cells = Y.cells ? Y.cells() : [];
  if(!cells.length){
    const t = el('text');
    t.setAttribute('x','580'); t.setAttribute('y','460');
    t.setAttribute('text-anchor','middle'); t.setAttribute('fill','#94a3b8');
    t.setAttribute('font-size','24'); t.setAttribute('font-weight','700');
    t.textContent = '야드 엑셀을 로드하면 위성 매핑이 표시됩니다';
    svg.appendChild(t);
    return;
  }

  ensureCache(cells);

  const img = el('image');
  img.setAttribute('x','0'); img.setAttribute('y','0');
  img.setAttribute('width', String(IMG_W)); img.setAttribute('height', String(IMG_H));
  img.setAttribute('href', satImg);
  img.setAttributeNS(XLINK, 'xlink:href', satImg);
  img.setAttribute('preserveAspectRatio','xMidYMid slice');
  svg.appendChild(img);

  const padX = IMG_W * 0.02, padY = IMG_H * 0.05;
  const items = watchCache.items;
  items.forEach((it, bi) => {
    const g = BUNDLE_GEOM[bi];
    if(!g) return;
    const gx = g.x * IMG_W, gw = g.w * IMG_W;
    const cell = it.cell;
    const high = cell.risk === 'HIGH';

    // 번들 영역 강조
    const bg = el('rect');
    bg.setAttribute('x', String(gx)); bg.setAttribute('y','0');
    bg.setAttribute('width', String(gw)); bg.setAttribute('height', String(IMG_H));
    bg.setAttribute('fill', high ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.08)');
    bg.setAttribute('stroke', high ? 'rgba(239,68,68,0.6)' : 'rgba(148,163,184,0.35)');
    bg.setAttribute('stroke-width','3');
    bg.setAttribute('rx','8');
    svg.appendChild(bg);

    // 슬롯 그리드 (5열 × 22행) — 22×5(데이터 순서)를 90도 시계방향 회전한 매핑
    const slotW = (gw - padX * 2) / SLOT_COLS;    // 가로 5칸
    const slotH = (IMG_H - padY * 2) / SLOT_ROWS;  // 세로 22칸
    it.slots.forEach((car, i) => {
      const r = i % SLOT_ROWS;                                             // 0..21 세로
      const c = SLOT_COLS - 1 - Math.floor(i / SLOT_ROWS);                 // 4..0 가로
      const rect = el('rect');
      rect.setAttribute('x', String(gx + padX + c * slotW + 1));
      rect.setAttribute('y', String(padY + r * slotH + 1));
      rect.setAttribute('width', String(slotW - 2));
      rect.setAttribute('height', String(slotH - 2));
      rect.setAttribute('rx','3');
      if(car.removed){                       // 출고 완료 → 셔플링 해소 → 검정
        rect.setAttribute('fill','rgba(8,10,14,0.9)');
        rect.setAttribute('stroke','rgba(148,163,184,0.25)');
        rect.setAttribute('stroke-width','1');
      } else if(car.shuffle && car.row === 3){   // 행3 셔플링(blocking) → G-Lifter 효과 영역 → 빨강
        rect.setAttribute('fill','rgba(239,68,68,0.85)');
        rect.setAttribute('stroke','rgba(255,255,255,0.75)');
        rect.setAttribute('stroke-width','1.4');
        rect.setAttribute('class','sat-pulse');
      } else {                               // 일반 차량
        rect.setAttribute('fill','rgba(255,255,255,0.28)');
        rect.setAttribute('stroke','rgba(255,255,255,0.55)');
        rect.setAttribute('stroke-width','1');
      }
      svg.appendChild(rect);
    });

    // 셀 라벨
    const label = el('text');
    label.setAttribute('x', String(gx + gw / 2));
    label.setAttribute('y', String(IMG_H * 0.03));
    label.setAttribute('text-anchor','middle');
    label.setAttribute('font-size','21');
    label.setAttribute('font-weight','800');
    label.setAttribute('fill', high ? '#ef4444' : '#e2e8f0');
    label.setAttribute('stroke','rgba(0,0,0,0.55)');
    label.setAttribute('stroke-width','0.6');
    const removedCnt = it.slots.filter(s => s.removed).length;
    label.textContent = cell.id + ' · 셔플 ' + cell.shuffleCount + '대' + (removedCnt ? ' · 출고 ' + removedCnt + '대' : '');
    svg.appendChild(label);
  });

  // G-Lifter 이동 경로 + 현재 위치 (출고 후)
  if(mode === 'after'){
    const gls = (Y.glifterState ? Y.glifterState() : []) as any[];
    const watchIds = items.map(it => it.cell.id);
    const center = (cellId: string) => {
      const bi = items.findIndex(it => it.cell.id === cellId);
      if(bi < 0) return null;
      const g = BUNDLE_GEOM[bi];
      return { x: g.x * IMG_W + g.w * IMG_W / 2, y: IMG_H - IMG_H * 0.07 };
    };
    gls.forEach(g => {
      const pts = g.path.filter((id: string) => watchIds.includes(id)).map(center).filter(Boolean) as { x: number; y: number }[];
      if(pts.length > 1){
        const pl = el('polyline');
        pl.setAttribute('points', pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
        pl.setAttribute('fill','none');
        pl.setAttribute('stroke','#f59e0b');
        pl.setAttribute('stroke-width','4');
        pl.setAttribute('stroke-dasharray','9,7');
        pl.setAttribute('opacity','0.9');
        svg.appendChild(pl);
      }
      if(watchIds.includes(g.cell)){
        const p = center(g.cell)!;
        const circ = el('circle');
        circ.setAttribute('cx', String(p.x)); circ.setAttribute('cy', String(p.y));
        circ.setAttribute('r','17');
        circ.setAttribute('fill','#f59e0b'); circ.setAttribute('stroke','#fff');
        circ.setAttribute('stroke-width','4');
        svg.appendChild(circ);
        const t = el('text');
        t.setAttribute('x', String(p.x)); t.setAttribute('y', String(p.y + 5));
        t.setAttribute('text-anchor','middle');
        t.setAttribute('font-size','14'); t.setAttribute('font-weight','900');
        t.setAttribute('fill','#7a4e00');
        t.textContent = g.id.replace('GL-0','').replace('GL-','');
        svg.appendChild(t);
      }
    });

    // 범례
    const lg = el('text');
    lg.setAttribute('x','24'); lg.setAttribute('y', String(IMG_H - 14));
    lg.setAttribute('font-size','15'); lg.setAttribute('font-weight','600');
    lg.setAttribute('fill','#f1f5f9');
    lg.setAttribute('stroke','rgba(0,0,0,0.6)'); lg.setAttribute('stroke-width','0.5');
    lg.textContent = '■ 행3 셔플링(blocking) · □ 일반 차량 · ▨ 출고 완료(검정) · ● G-Lifter';
    svg.appendChild(lg);
  }
}
