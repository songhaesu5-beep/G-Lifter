/* =========================================================
   AI Provider — 실제 AI API 연동을 위한 추상화 계층
   - 현재: provider='mock' → AIExplainer(규칙 기반) 사용
   - 추후 배포: provider='api' + endpoint 설정 시 실제 LLM 호출
   - API 실패 시 자동으로 mock으로 폴백

   API 응답 형식 (JSON):
   { diagnosis: string, cause: string, prediction: string, recommendation: string }
   ========================================================= */
import { AIExplainer, type AIAnalysis, type AIAnalysisState } from './aiExplainer';

export const AIConfig = {
  provider: 'mock',     // 'mock' | 'api'
  endpoint: ''          // 예: '/api/ai/analyze'
};

export const AIProvider = {
  async analyze(state: AIAnalysisState): Promise<AIAnalysis> {
    if(AIConfig.provider === 'api' && AIConfig.endpoint){
      try{
        const res = await fetch(AIConfig.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: state })
        });
        if(!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if(!data || typeof data.diagnosis !== 'string'){
          throw new Error('AI 응답 형식 오류');
        }
        return data;
      }catch(err){
        console.error('[AI API 호출 실패 → mock 폴백]', err);
        return AIExplainer.analyze(state);
      }
    }
    return AIExplainer.analyze(state);
  }
};
