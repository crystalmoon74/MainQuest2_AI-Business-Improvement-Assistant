// 공용 분석 로직 — 기본 사이트(app.js)와 v2 사이트(v2/app.js)가 함께 사용한다.
// Python 버전(agent/)과 같은 프롬프트·스키마(config.js)·가드레일 규칙.
import { SYSTEM_PROMPT, REPORT_SCHEMA } from "./config.js?v=2";

export const MAX_QUESTIONS = 10;


// 무료 티어 텍스트 모델 (2026-11 Google AI Studio 가격표 기준). auto는 AUTO_CHAIN 순서로 시도한다.
export const MODELS = [
  ["auto", "자동 선택 (권장) — 실패 시 다음 모델로 전환"],
  ["gemini-3.8-flash", "Gemini 3.8 Flash — 최신"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash"],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite — 빠름"],
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite — 빠름"],
  ["gemini-4-hydrogen", "Gemini 4 Hydrogen — 고품질·느림(1분+)"],
];
export const AUTO_CHAIN = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];

export class AnalysisError extends Error {
  constructor(message, retryable = true, switchModel = retryable) { super(message); this.retryable = retryable; this.switchModel = switchModel; }
}


export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

// ---------- 입력 검증 (F01) ----------
export function validateInput(taskName, problem) {
  const errors = [];
  if (!taskName.trim()) errors.push("업무명을 입력해 주세요.");
  if (!problem.trim()) errors.push("현재 업무 및 문제점 설명을 입력해 주세요.");
  else if (problem.trim().length < 10) errors.push("문제점 설명이 너무 짧습니다. 한두 문장 이상 적어 주세요.");
  if ((taskName + problem).length > 8000) errors.push("입력이 너무 깁니다(8,000자 이하). 핵심 내용 위주로 줄여 주세요.");
  return errors;
}

export function buildUserMessage({ taskName, problem, improvement, answers }) {
  const parts = ["다음 업무 개선 요청을 분석해 주세요.", "", "<request>",
    `[업무명]\n${taskName.trim()}`, "", `[현재 업무 및 문제점]\n${problem.trim()}`, "",
    `[개선하고 싶은 내용]\n${improvement.trim() || "(입력 없음)"}`];
  if (answers?.length) {
    parts.push("", "[추가 확인 답변]");
    for (const qa of answers) parts.push(`Q. ${qa.question}\nA. ${qa.answer.trim()}`);
  }
  parts.push("</request>");
  return parts.join("\n");
}
export const sourceText = ({ taskName, problem, improvement, answers }) =>
  [taskName, problem, improvement, ...(answers || []).map((a) => a.answer)].join("\n");


// ---------- Gemini 호출 (F02, F03) ----------
export async function callGemini(apiKey, model, userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 16000, responseMimeType: "application/json", responseJsonSchema: REPORT_SCHEMA },
  };
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body) });
  } catch {
    throw new AnalysisError("AI 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.", true, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = JSON.stringify(data);
    if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/.test(msg) || res.status === 401 || res.status === 403)
      throw new AnalysisError("Gemini API 키가 올바르지 않습니다. 왼쪽 설정에서 키를 확인해 주세요.", false, false);
    if (res.status === 429) throw new AnalysisError("무료 사용량 한도 초과");
    if (res.status === 404) throw new AnalysisError("이 키로 사용할 수 없는 모델", false, true);
    if (res.status >= 500) throw new AnalysisError("서버 혼잡(일시 오류)");
    throw new AnalysisError(`요청 오류(HTTP ${res.status}): ${data?.error?.message || ""}`, false, false);
  }
  const cand = data.candidates?.[0];
  if (!cand) throw new AnalysisError("AI가 이 요청에 응답하지 않았습니다(안전 정책 등). 내용을 수정해 다시 시도해 주세요.", false, false);
  if (cand.finishReason === "MAX_TOKENS") throw new AnalysisError("응답이 길어 중간에 끊김");
  if (cand.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(cand.finishReason))
    throw new AnalysisError(`AI가 응답을 완료하지 못했습니다(${cand.finishReason}). 내용을 수정해 다시 시도해 주세요.`, false, false);
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  let report;
  try { report = JSON.parse(text); } catch { throw new AnalysisError("응답 형식 오류"); }
  const u = data.usageMetadata || {};
  return { report, usage: { input_tokens: u.promptTokenCount, output_tokens: u.candidatesTokenCount } };
}

// 선택한 모델(또는 auto 체인)로 시도하고, 한도 초과·혼잡·사용 불가면 다음 모델로 넘어간다.
export async function callWithFallback(apiKey, choice, userMessage, onTry) {
  const chain = choice === "auto" ? AUTO_CHAIN : [choice];
  const attempts = [];
  for (const model of chain) {
    onTry?.(model, attempts);
    try {
      const out = await callGemini(apiKey, model, userMessage);
      attempts.push({ model, result: "성공" });
      return { ...out, model, attempts };
    } catch (e) {
      attempts.push({ model, result: e.message });
      if (!e.switchModel) throw Object.assign(e, { attempts });
    }
  }
  const detail = attempts.map((a) => `${a.model}: ${a.result}`).join(" · ");
  throw Object.assign(new AnalysisError(chain.length > 1
    ? `무료 모델이 모두 한도 초과 또는 혼잡 상태입니다. 1~2분 뒤 다시 시도해 주세요. (${detail})`
    : `${chain[0]} 사용 불가: ${attempts[0].result}. 모델을 '자동 선택'으로 바꿔 보세요.`), { attempts });
}

// ---------- 가드레일 (agent/guardrails.py 와 동일 규칙) ----------
const norm = (s) => String(s || "").replace(/[\s"'“”‘’.,·…()[\]~!?:;-]/g, "").toLowerCase();

export function evidenceInSource(evidence, source) {
  const ev = norm(evidence), src = norm(source);
  if (!ev) return false;
  if (src.includes(ev)) return true;
  const pieces = String(evidence).split(/…|\.\.\.|\//).map(norm).filter((p) => p.length >= 4);
  return pieces.length > 0 && pieces.every((p) => src.includes(p));
}

function similarity(a, b) { // 2*LCS/(|a|+|b|) — Python SequenceMatcher.ratio()에 가까운 값
  if (!a.length && !b.length) return 1;
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return (2 * dp[b.length]) / (a.length + b.length);
}

export function applyGuardrails(r, source) {
  const log = [];
  const check = (item, where) => {
    if (item?.status === "확인" && !evidenceInSource(item.evidence, source)) {
      log.push({ type: "근거 불일치 → 추정으로 강등", where, content: item.content || item.step || "", evidence: item.evidence });
      item.status = "추정";
      item.evidence = `(원문에서 인용 확인 불가) ${item.evidence || ""}`.trim();
    }
  };
  check(r.task_purpose, "업무 목적");
  (r.as_is_process || []).forEach((s) => check(s, `현재 업무 절차 ${s.order}`));
  [["주요 문제점", r.problems], ["개선 목적", r.improvement_goals], ["기대 효과", r.expected_effects]]
    .forEach(([name, items]) => (items || []).forEach((f, i) => check(f, `${name} ${i + 1}`)));

  const confirmed = new Set(r.confirmed_categories || []);
  let kept = [];
  for (const q of r.questions || []) {
    if (confirmed.has(q.category) && q.category !== "기타") { log.push({ type: "이미 확인된 범주 질문 제거", where: q.category, content: q.question }); continue; }
    if (kept.some((k) => similarity(norm(q.question), norm(k.question)) > 0.8)) { log.push({ type: "중복 질문 제거", where: q.category, content: q.question }); continue; }
    kept.push(q);
  }
  if (kept.length > MAX_QUESTIONS) {
    kept.slice(MAX_QUESTIONS).forEach((q) => log.push({ type: "질문 10개 초과분 제거", where: q.category, content: q.question }));
    kept = kept.slice(0, MAX_QUESTIONS);
  }
  r.questions = kept;
  return log;
}


