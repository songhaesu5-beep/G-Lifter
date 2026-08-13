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
}

export interface AIAnalysis {
  diagnosis: string;
  cause: string;
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
  // 4단계 AI 분석: 진단 / 원인 / 예측 / 추천
  // ============================================================
  const MOV_TIME = 2;   // G-Lifter 셀 간 이동 소요(분)

  function analyze(st){
    // 1) 진단: 현재 해소 수준 + 전체 완료 예상 시간
    let diagnosis;
    if(st.progress > 0){
      const etaMin = Math.round(st.t / st.progress * st.dispatch);
      const etaHour = Math.round(etaMin / 60 * 10) / 10;
      diagnosis = fmt(st.progress) + '대 처리 기준 해소율 ' + st.rate + '%는 초기 셔플링 ' + fmt(st.shuffleTotal) +
        '건 중 ' + fmt(st.resolved) + '건만 해소된 수준입니다. 이 속도면 전체 완료까지 약 ' + fmt(etaHour) + '시간이 소요됩니다.';
    } else {
      diagnosis = '아직 처리된 지시가 없어 진단할 수 없습니다.';
    }

    // 2) 원인: G-Lifter 대수 부족 + 이동 시간 비중
    const n = st.glifterState.length;
    const shortage = n < st.riskHigh ? '물리적으로 부족하고' : '충분하지만';
    const moveMin = Math.round(st.moves * MOV_TIME * 10) / 10;
    const moveRatio = st.t > 0 ? Math.round(st.moves * MOV_TIME / st.t * 100) : 0;
    const cause = 'G-Lifter ' + n + '대가 ' + fmt(st.riskHigh) + '개 고위험 셀을 커버하기에 ' + shortage +
      ', 셀 간 이동에 총 ' + fmt(moveMin) + '분(전체 ' + moveRatio + '%)을 소비해 작업 대비 이동 비중이 높습니다.';

    // 3) 예측: 잔존 처리에 필요한 추가 시간
    let prediction;
    if(st.pending === 0){
      prediction = '잔존 셔플링이 없습니다.';
    } else if(st.resolved > 0 && st.t > 0){
      const addMin = Math.round(st.pending * st.t / st.resolved);
      const addHour = Math.round(addMin / 60 * 10) / 10;
      prediction = '잔존 셔플링 ' + fmt(st.pending) + '건을 현재 속도로 처리하면 추가 약 ' + fmt(addMin) + '분(약 ' + addHour + '시간)이 필요합니다.';
    } else {
      prediction = '아직 해소 실적이 없어 잔존 처리 시간을 예측할 수 없습니다.';
    }

    // 4) 추천: 셔플링 집중 셀 + G-Lifter 이동 제안
    let recommendation;
    if(st.topShuffle && st.topShuffle.length){
      const topIds = st.topShuffle.map(t=>t.id).join('·');
      const target = st.topShuffle[0];
      const g = st.glifterState.slice().sort((a,b)=> (a.moves||0)-(b.moves||0))[0];
      recommendation = '고위험 셀 중 ' + topIds + '에 셔플링이 집중되어 있습니다. ' + g.id + '를 ' + g.cell +
        '에서 ' + target.id + ' 방향으로 이동시키고, 남은 작업은 상위 3개 셀 우선 처리로 전환을 권고합니다.';
    } else {
      recommendation = '현재 남은 셔플링이 없어 추가 조치가 필요하지 않습니다.';
    }

    return { diagnosis: diagnosis, cause: cause, prediction: prediction, recommendation: recommendation };
  }

  return { explain: explain, analyze: analyze };
})();

export default AIExplainer;
