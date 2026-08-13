/* =========================================================
   AI 출고 상황 자연어 설명 (Mock AI)
   - 시뮬레이션 페이지와 분리된 독립 모듈
   - 규칙 기반 템플릿 + 랜덤 변형으로 자연어 문장 생성
   - 사용법: AIExplainer.explain(state) → 자연어 문자열
   state: { dispatch, matched, progress, t, finished,
            direct, shuffleTotal, resolved, pending, rate,
            riskHigh, moves, glifterState }
   ========================================================= */

export interface AIAnalysisState {
  dispatch: number;
  matched: number;
  progress: number;
  t: number;
  finished: boolean;
  direct: number;
  shuffleTotal: number;
  resolved: number;
  pending: number;
  rate: number;
  riskHigh: number;
  moves: number;
  glifterState: Array<{ id: string; cell: string; moves?: number }>;
  topShuffle?: Array<{ id: string; count: number }>;
  humanMin?: number;
  savedMin?: number;
  humanPending?: number;
}

export interface AIAnalysis {
  diagnosis: string;
  cellAnalysis: string;
  prediction: string;
  recommendation: string;
}

export const AIExplainer = (function(){

  function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(n){ return Number(n).toLocaleString('ko-KR'); }

  function explain(st){
    const parts = [];

    // 1) 진행 상황
    if(st.finished){
      parts.push(pick([
        '출고 작업이 완료되었습니다. 지시 ' + fmt(st.dispatch) + '대 중 ' + fmt(st.matched) + '대가 처리되었고, 총 경과 시간은 ' + fmt(Math.round(st.t)) + '분입니다.',
        '전체 출고가 마무리됐어요. ' + fmt(st.dispatch) + '대 지시 중 ' + fmt(st.matched) + '대가 출고되었으며, 작업 시간은 약 ' + fmt(Math.round(st.t)) + '분이 걸렸습니다.',
        '모든 출고 지시에 대한 처리가 끝났습니다. 매칭 ' + fmt(st.matched) + '대 · 소요 ' + fmt(Math.round(st.t)) + '분으로 집계되었습니다.'
      ]));
    } else {
      parts.push(pick([
        '현재 지시 ' + fmt(st.dispatch) + '대 중 ' + fmt(st.progress) + '대가 처리되었고, 경과 시간은 ' + fmt(Math.round(st.t)) + '분입니다.',
        '출고가 진행 중입니다. 목록의 ' + fmt(st.progress) + '/' + fmt(st.dispatch) + '대까지 처리했으며 ' + fmt(Math.round(st.t)) + '분이 지났습니다.'
      ]));
    }

    // 2) 셔플링 상황
    if(st.shuffleTotal > 0){
      if(st.rate === 100){
        parts.push(pick([
          '발생한 셔플링 ' + fmt(st.shuffleTotal) + '건이 전부 해소되어 해소율 100%를 달성했습니다.',
          '셔플링 ' + fmt(st.shuffleTotal) + '건이 모두 해소되었습니다. G-Lifter가 완벽하게 대응하고 있어요.'
        ]));
      } else if(st.rate >= 50){
        parts.push(pick([
          '셔플링 ' + fmt(st.shuffleTotal) + '건 중 ' + fmt(st.resolved) + '건이 해소되어 해소율 ' + st.rate + '%입니다. 잔존 ' + fmt(st.pending) + '건은 G-Lifter가 미커버한 셀에서 발생했습니다.',
          '해소율 ' + st.rate + '% 수준입니다. 아직 ' + fmt(st.pending) + '건의 셔플링이 남아 있어 G-Lifter 확대를 검토할 수 있습니다.'
        ]));
      } else {
        parts.push(pick([
          '셔플링 ' + fmt(st.shuffleTotal) + '건 중 ' + fmt(st.resolved) + '건만 해소(해소율 ' + st.rate + '%)되어 대부분 잔존 상태입니다. 출고 목록의 순서와 G-Lifter 이동 순서의 차이가 원인으로 보입니다.',
          '해소율이 ' + st.rate + '%로 낮습니다. 잔존 셔플링 ' + fmt(st.pending) + '건은 G-Lifter가 아직 도달하지 못한 셀에서 발생하고 있어요.'
        ]));
      }
    } else {
      parts.push(pick([
        '출고 목록에 셔플링 차량이 포함되어 있지 않아 셔플링은 발생하지 않았습니다.',
        '셔플링 없이 지시가 직접 출고(Direct Pick-up)로 처리되고 있습니다.'
      ]));
    }

    // 3) G-Lifter 동향
    const gLocs = st.glifterState.map(g=>g.id + '는 ' + g.cell + '에 있습니다').join(', ');
    if(st.moves > 0){
      parts.push(pick([
        'G-Lifter는 총 ' + st.moves + '회 이동했으며, 현재 ' + gLocs + '.',
        'G-Lifter가 ' + st.moves + '회 이동하며 위험도 순서대로 대응 중입니다. ' + gLocs + '.'
      ]));
    } else {
      parts.push(pick([
        'G-Lifter는 이동 없이 초기 배치(위험도 최상위 셀)에 대기 중입니다: ' + gLocs + '.',
        'G-Lifter ' + st.glifterState.length + '대 모두 초기 위치를 유지하고 있습니다: ' + gLocs + '.'
      ]));
    }

    // 4) 위험도 / 직접 출고
    parts.push(pick([
      '고위험(빨간색) 셀은 ' + fmt(st.riskHigh) + '개이며, Direct Pick-up은 ' + fmt(st.direct) + '대입니다.',
      '현재 위험 셀 ' + fmt(st.riskHigh) + '개 · Direct Pick-up ' + fmt(st.direct) + '대가 집계되고 있습니다.'
    ]));

    return parts.join(' ');
  }

  // ============================================================
  // 4단계 AI 분석: 진단 / 셀 분석 / 리포트 / 추천
  // ============================================================

  function analyze(st){
    // 1) 진단: 현재 해소 수준 + 시간 비교
    let diagnosis;
    if(st.finished){
      diagnosis = '작업 완료: 해소율 ' + st.rate + '% · 지시 셔플링 ' + fmt(st.shuffleTotal) + '건 중 ' + fmt(st.resolved) + '건 해소';
    } else if(st.progress > 0){
      const etaMin = Math.round(st.t / st.progress * st.dispatch);
      const etaHour = Math.round(etaMin / 60 * 10) / 10;
      diagnosis = fmt(st.progress) + '대 처리 기준 해소율 ' + st.rate + '%는 지시 셔플링 ' + fmt(st.shuffleTotal) +
        '건 중 ' + fmt(st.resolved) + '건만 해소된 수준입니다. 이 속도면 전체 완료까지 약 ' + fmt(etaHour) + '시간이 소요됩니다.';
    } else {
      diagnosis = '아직 처리된 지시가 없어 진단할 수 없습니다.';
    }
    // 시간 비교 (G-Lifter 5분/건 vs 인간 10분/건)
    if(st.humanMin !== undefined && st.t > 0){
      diagnosis += ' G-Lifter 소요 ' + fmt(Math.round(st.t)) + '분은 인간 동일 처리(' + fmt(st.humanMin) + '분) 대비 ' + fmt(st.savedMin) + '분 절약 수준입니다.';
    }

    // 2) 셀 분석: 남은 셔플링이 가장 많은 셀 — 먼저 처리 시 해소율 상승분
    let cellAnalysis;
    const topCell = st.topShuffle && st.topShuffle.length ? st.topShuffle[0] : null;
    if(topCell){
      const deep = topCell.deepCount !== undefined ? topCell.deepCount : topCell.count;   // 행3(Deep Lane 3번째) 셔플링 수
      const pctUp = st.shuffleTotal > 0 ? Math.round(topCell.count / st.shuffleTotal * 100) : 0;
      cellAnalysis = topCell.id + ' 셀 — 이 셀에 셔플링 차량 ' + fmt(topCell.count) + '대가 출고 경로를 막고 있습니다. ' +
        '그중 ' + fmt(deep) + '대는 행3(Deep Lane 3번째) 위치라 G-Lifter 없이는 출고가 불가능합니다. ' +
        topCell.id + '를 먼저 처리하면 전체 해소율이 ' + pctUp + '%p 오릅니다.';
    } else {
      cellAnalysis = '현재 남은 셔플링이 없어 분석할 셀이 없습니다.';
    }

    // 3) 리포트: 출고 현황 + 잔존 집중 + G-Lifter 추가 효과
    let prediction;
    const dispatchedOut = st.direct + st.resolved;   // 출고 완료된 지시 대수
    if(st.shuffleTotal === 0){
      prediction = '지시 ' + fmt(st.dispatch) + '대 중 ' + fmt(dispatchedOut) + '대가 출고됐고, 지시된 셔플링이 없어 해소율을 판단할 수 없습니다.';
    } else if(st.finished){
      prediction = '지시 ' + fmt(st.dispatch) + '대 중 ' + fmt(dispatchedOut) + '대가 출고됐고, 지시 셔플링 ' + fmt(st.shuffleTotal) +
        '건 중 ' + fmt(st.resolved) + '건이 해소됐습니다(해소율 ' + st.rate + '%).';
      if(st.pending > 0){
        const hotCells = (st.topShuffle || []).slice(0, 2).map(t=>t.id).join('·');
        const addRate = Math.min(100, Math.round(st.rate + (2 / Math.max(1, st.glifterState.length)) * (100 - st.rate)));
        prediction += ' 잔존 ' + fmt(st.pending) + '건은 ' + hotCells + '에 집중돼 있어, G-Lifter를 2대 추가하면 예상 해소율 ' + addRate + '%까지 올라갑니다.';
      } else {
        prediction += ' 잔존 셔플링이 없습니다.';
      }
    } else {
      prediction = '지시 ' + fmt(st.dispatch) + '대 중 ' + fmt(dispatchedOut) + '대 출고 · 지시 셔플링 ' + fmt(st.shuffleTotal) +
        '건 중 ' + fmt(st.resolved) + '건 해소(해소율 ' + st.rate + '%) · 작업 진행 중입니다.';
    }

    // 4) 추천: 잔존 셔플링 최다 셀로 G-Lifter 이동 제안
    let recommendation;
    if(topCell && st.glifterState.length){
      const g = st.glifterState.slice().sort((a,b)=> (a.moves||0)-(b.moves||0))[0];   // 가장 덜 움직인 G-Lifter
      const pctUp = st.shuffleTotal > 0 ? Math.round(topCell.count / st.shuffleTotal * 100) : 0;
      if(g.cell === topCell.id){
        recommendation = g.id + '은 현재 ' + topCell.id + '에 위치해 있습니다. 해당 셀의 잔존 셔플링 ' + fmt(topCell.count) + '건을 해소하면 해소율이 ' + pctUp + '%p 상승합니다.';
      } else {
        recommendation = g.id + '은 현재 ' + g.cell + '에 있습니다. 잔존 셔플링이 가장 많은 ' + topCell.id +
          '로 이동하면 해소 ' + fmt(topCell.count) + '건, 해소율이 ' + pctUp + '%p 상승합니다.';
      }
    } else {
      recommendation = '잔존 셔플링이 없어 추가 이동이 필요하지 않습니다.';
    }

    return { diagnosis: diagnosis, cellAnalysis: cellAnalysis, prediction: prediction, recommendation: recommendation };
  }

  return { explain: explain, analyze: analyze };
})();

export default AIExplainer;
