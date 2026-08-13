/* =========================================================
   AI Provider — 실제 Gemini API 연동
   - .env (저장소 루트) → vite define → __GEMINI_API_KEY__ / __GEMINI_MODEL__
   - Gemini generateContent 호출 → JSON 응답 파싱
   - 실패 시 자동으로 AIExplainer(mock) 폴백

   응답 형식 (Gemini JSON):
   { diagnosis: string, cellAnalysis: string, prediction: string, recommendation: string }
   ========================================================= */
import { AIExplainer, type AIAnalysis, type AIAnalysisState } from './aiExplainer';

declare const __GEMINI_API_KEY__: string;
declare const __GEMINI_MODEL__: string;

export const AIConfig = {
  provider: 'api' as 'mock' | 'api',   // 'mock' | 'api'
  endpoint: ''                          // 예약 (직접 API 호출 방식 사용)
};

function buildPrompt(st: AIAnalysisState): string {
  const gLocs = st.glifterState.map(g => g.id + '는 ' + g.cell + '에 위치').join(', ') || '없음';
  const hotCells = (st.topShuffle || []).map(t => t.id + '(' + t.count + '대)').join(', ') || '없음';
  return `당신은 항만 야적장의 G-Lifter 배치 의사결정을 돕는 운영 분석 전문가입니다. 아래 시뮬레이션 상태를 바탕으로 한국어로 4개 항목을 분석하세요.

[시뮬레이션 상태]
- 지시 차량: ${st.dispatch}대, 처리: ${st.progress}대, 경과: ${Math.round(st.t)}분
- 지시 셔플링: ${st.shuffleTotal}건 중 해소 ${st.resolved}건 (해소율 ${st.rate}%)
- 잔존(미해소): ${st.pending}건
- Direct 출고: ${st.direct}대
- G-Lifter ${st.glifterState.length}대 배치: ${gLocs}
- 잔존 셔플링 집중 셀(상위 3): ${hotCells}
- G-Lifter 소요 ${Math.round(st.t)}분 vs 인간 동일 처리 ${st.humanMin}분 (절약 ${st.savedMin}분)
- 작업 상태: ${st.finished ? '완료' : '진행 중'}

작성 규칙:
1. diagnosis(진단): 현재 해소 수준과 완료 예상 시간을 말하고, 수치 뒤에 운영상 의미를 한 문장으로.
2. cellAnalysis(셀 분석): 잔존 셔플링 최다 셀의 blocking 현황과 그 셀을 먼저 처리할 때의 해소율 상승 효과.
3. prediction(리포트): 지시 출고 현황 요약 + 잔존 집중 지점과 G-Lifter 추가 시 예상 해소율 + 운영 의미.
4. recommendation(추천): 특정 G-Lifter를 잔존 최다 셀로 이동하는 구체적 제안(소요 시간·해소 건수·해소율 상승 %p) + 운영 효율성 평가.

반드시 아래 JSON 형식으로만 답변하세요 (다른 텍스트 없이):
{"diagnosis": "...", "cellAnalysis": "...", "prediction": "...", "recommendation": "..."}`;
}

function parseResponse(text: string): AIAnalysis | null {
  const m = text.match(/\{[\s\S]*\}/);
  if(!m) return null;
  try{
    const obj = JSON.parse(m[0]);
    if(obj && typeof obj.diagnosis === 'string' && typeof obj.cellAnalysis === 'string' &&
       typeof obj.prediction === 'string' && typeof obj.recommendation === 'string'){
      return obj;
    }
  }catch(e){ /* 파싱 실패 시 null */ }
  return null;
}

export const AIProvider = {
  async analyze(state: AIAnalysisState): Promise<AIAnalysis> {
    if(AIConfig.provider === 'api'){
      try{
        const key = typeof __GEMINI_API_KEY__ !== 'undefined' ? __GEMINI_API_KEY__ : '';
        const model = typeof __GEMINI_MODEL__ !== 'undefined' ? __GEMINI_MODEL__ : 'gemini-pro-latest';
        if(!key) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: buildPrompt(state) }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
            })
          }
        );
        if(!res.ok){
          const errText = await res.text().catch(() => '');
          throw new Error('Gemini HTTP ' + res.status + ' ' + errText.slice(0, 120));
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = parseResponse(text);
        if(parsed) return parsed;
        throw new Error('Gemini 응답 파싱 실패: ' + text.slice(0, 100));
      }catch(err){
        console.error('[Gemini API 호출 실패 → mock 폴백]', err);
        return AIExplainer.analyze(state);
      }
    }
    return AIExplainer.analyze(state);
  }
};
