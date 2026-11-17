// AI 업무 개선 요청 분석 Assistant — 브라우저 버전 (GitHub Pages)
// Python(Google ADK) 버전과 같은 프롬프트·스키마(config.js, 자동 생성)·가드레일 규칙을 사용한다.
// 방문자가 입력한 Gemini API 키로 브라우저에서 Google API를 직접 호출한다.
import { SYSTEM_PROMPT, REPORT_SCHEMA } from "./config.js?v=2";
import { buildReport, standaloneHTML, esc, STEPS } from "./report.js?v=2";

const $ = (id) => document.getElementById(id);
const MAX_QUESTIONS = 10;
const KEY_STORE = "mq2_gemini_key";
const VIEW_STORE = "mq2_view";

// 무료 티어 텍스트 모델 (2026-11 Google AI Studio 가격표 기준). auto는 AUTO_CHAIN 순서로 시도한다.
const MODELS = [
  ["auto", "자동 선택 (권장) — 실패 시 다음 모델로 전환"],
  ["gemini-3.8-flash", "Gemini 3.8 Flash — 최신"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash"],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite — 빠름"],
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite — 빠름"],
  ["gemini-4-hydrogen", "Gemini 4 Hydrogen — 고품질·느림(1분+)"],
];
const AUTO_CHAIN = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];

const state = { cases: [], samples: {}, result: null, answers: [], lastArgs: null, busy: false, view: "paged", step: 0, css: null };

class AnalysisError extends Error {
  constructor(message, retryable = true, switchModel = retryable) { super(message); this.retryable = retryable; this.switchModel = switchModel; }
}

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

// ---------- 입력 검증 (F01) ----------
function validateInput(taskName, problem) {
  const errors = [];
  if (!taskName.trim()) errors.push("업무명을 입력해 주세요.");
  if (!problem.trim()) errors.push("현재 업무 및 문제점 설명을 입력해 주세요.");
  else if (problem.trim().length < 10) errors.push("문제점 설명이 너무 짧습니다. 한두 문장 이상 적어 주세요.");
  if ((taskName + problem).length > 8000) errors.push("입력이 너무 깁니다(8,000자 이하). 핵심 내용 위주로 줄여 주세요.");
  return errors;
}

function buildUserMessage({ taskName, problem, improvement, answers }) {
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
const sourceText = ({ taskName, problem, improvement, answers }) =>
  [taskName, problem, improvement, ...(answers || []).map((a) => a.answer)].join("\n");


// ---------- Gemini 호출 (F02, F03) ----------
async function callGemini(apiKey, model, userMessage) {
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
async function callWithFallback(apiKey, choice, userMessage, onTry) {
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

function evidenceInSource(evidence, source) {
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

function applyGuardrails(r, source) {
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


// ---------- 분석 진행 표시 ----------
const STAGES = ["입력 검증", "AI 요구사항 구조화 · 누락 정보 질문 생성", "근거 검증 (가드레일)", "보고서 생성"];
let timer = null;
function showProgress(stage, note = "") {
  const t0 = state.t0;
  const render = () => {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    $("messages").innerHTML = `<div class="card progress"><h2 class="card-title"><span class="k">분석 중</span>AI Assistant가 요청을 분석하고 있습니다</h2>
      <ol>${STAGES.map((s, i) => `<li class="${i < stage ? "done" : i === stage ? "now" : ""}"><span class="ic">${i < stage ? "✓" : ""}</span>${esc(s)}${i === 1 && note ? ` <span class="elapsed">· ${esc(note)}</span>` : ""}</li>`).join("")}</ol>
      <p class="hint">경과 ${sec}초 · 보통 15~60초 걸립니다.</p></div>`;
  };
  clearInterval(timer);
  render();
  timer = setInterval(render, 1000);
}
function stopProgress() { clearInterval(timer); timer = null; }

// ---------- 분석 실행 ----------
async function runAnalysis(answers) {
  if (state.busy) return;
  const args = { taskName: $("taskName").value, problem: $("problem").value, improvement: $("improvement").value, answers };
  const errs = validateInput(args.taskName, args.problem);
  if (errs.length) return showMessage("err", errs.map(esc).join("<br>"));
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) return showMessage("warn", `Gemini API 키를 왼쪽 설정에 입력해 주세요 (<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">무료 발급</a>). 키 없이 보려면 <b>결과 미리보기</b>를 누르세요.`);
  rememberKey();
  state.lastArgs = args;
  setBusy(true);
  state.t0 = performance.now();
  showProgress(1);
  try {
    const out = await callWithFallback(apiKey, $("model").value, buildUserMessage(args), (m, tried) =>
      showProgress(1, tried.length ? `${tried.at(-1).model} 실패(${tried.at(-1).result}) → ${m} 로 전환` : m));
    showProgress(2);
    const log = applyGuardrails(out.report, sourceText(args));
    showProgress(3);
    state.result = { report: out.report, guardrail_log: log, elapsed_sec: ((performance.now() - state.t0) / 1000).toFixed(1),
      model: out.model, usage: out.usage, attempts: out.attempts, mode: "live" };
    state.answers = answers || [];
    stopProgress();
    const switched = out.attempts.length > 1 ? `<div class="msg info">🔁 ${esc(out.attempts.slice(0, -1).map((a) => `${a.model}(${a.result})`).join(", "))} → <b>${esc(out.model)}</b>로 자동 전환해 분석했습니다.</div>` : "";
    $("messages").innerHTML = switched;
    renderResult(0);
  } catch (e) {
    stopProgress();
    const retry = e.retryable !== false ? ` <button type="button" class="btn" id="retryBtn">다시 시도</button>` : "";
    showMessage("err", `<span>분석에 실패했습니다. ${esc(e.message)}</span>${retry}`);
    $("retryBtn")?.addEventListener("click", () => runAnalysis(state.lastArgs?.answers || []));
  } finally {
    setBusy(false);
  }
}

function setBusy(b) {
  state.busy = b;
  $("analyzeBtn").disabled = b;
  $("analyzeBtn").textContent = b ? "분석 중…" : "분석 시작";
}
function showMessage(kind, html) { stopProgress(); $("messages").innerHTML = `<div class="msg ${kind}">${html}</div>`; }
function clearMessages() { stopProgress(); $("messages").innerHTML = ""; }
function rememberKey() {
  if ($("rememberKey").checked) storage.set(KEY_STORE, $("apiKey").value.trim());
  else storage.del(KEY_STORE);
}

// ---------- 결과 화면 (F04) ----------
function renderResult(step = 0) {
  const res = state.result, r = res.report;
  const sampleNote = res.mode === "sample"
    ? `<div class="msg info">📂 미리 실행해 둔 실제 Gemini 분석 결과입니다. 직접 분석하려면 API 키를 입력하고 <b>분석 시작</b>을 누르세요.</div>` : "";
  const answerCard = (r.questions || []).length ? `<form id="answerForm" class="card answers-card">
      <h2 class="card-title"><span class="k">F05</span>추가 질문에 답하고 보고서 갱신</h2>
      <p class="hint">알고 있는 항목만 답해 주세요. 답변을 원문에 더해 다시 분석합니다.</p>
      ${r.questions.map((q, i) => `<div class="q-input"><label for="ans${i}"><span class="cat">${esc(q.category)}</span><br>Q${i + 1}. ${esc(q.question)}</label>
        <input type="text" id="ans${i}" data-q="${esc(q.question)}" placeholder="답변 (선택)"></div>`).join("")}
      <div class="form-actions"><button class="btn primary" type="submit">답변 반영하여 보고서 갱신</button></div></form>` : "";

  $("result").innerHTML = `${sampleNote}
    <div class="result-bar">
      <div class="seg" role="group" aria-label="보기 방식">
        <button type="button" data-view="paged" aria-pressed="${state.view === "paged"}">단계별 보기</button>
        <button type="button" data-view="all" aria-pressed="${state.view === "all"}">전체 보기</button>
      </div>
      <button type="button" class="btn dark" id="downloadHtml">⬇ HTML 보고서 다운로드</button>
    </div>
    <div id="reportHost">${buildReport(res, state.answers)}</div>
    ${answerCard}`;

  const root = $("reportHost").querySelector(".rpt");
  const slides = [...root.querySelectorAll(".slide")];
  const links = [...root.querySelectorAll(".rpt-steps a")];
  const go = (i, scroll = true) => {
    state.step = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => s.classList.toggle("current", k === state.step));
    links.forEach((a, k) => { a.classList.toggle("active", k === state.step); a.classList.toggle("done", k < state.step); });
    root.querySelector(".pager .prev").disabled = state.step === 0;
    const next = root.querySelector(".pager .next");
    next.disabled = state.step === slides.length - 1;
    next.textContent = state.step < slides.length - 1 ? `다음: ${STEPS[state.step + 1].short} →` : "마지막 단계";
    root.querySelector(".pager .pos").textContent = `${state.step + 1} / ${slides.length}`;
    if (scroll) root.querySelector(".rpt-steps").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const applyView = () => {
    root.classList.toggle("paged", state.view === "paged");
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  };
  links.forEach((a, k) => a.addEventListener("click", (ev) => {
    if (state.view !== "paged") return; // 전체 보기에서는 기본 앵커 이동
    ev.preventDefault(); go(k);
  }));
  root.querySelector(".pager .prev").addEventListener("click", () => go(state.step - 1));
  root.querySelector(".pager .next").addEventListener("click", () => go(state.step + 1));
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view; storage.set(VIEW_STORE, state.view); applyView();
  }));
  applyView();
  go(step, false);

  $("downloadHtml").addEventListener("click", downloadHtml);
  $("answerForm")?.addEventListener("submit", (ev) => { // F05
    ev.preventDefault();
    const fresh = [...ev.target.querySelectorAll("input[data-q]")].filter((i) => i.value.trim())
      .map((i) => ({ question: i.dataset.q, answer: i.value.trim() }));
    if (!fresh.length) return showMessage("warn", "최소 1개 이상 답변을 입력해 주세요.");
    runAnalysis([...state.answers, ...fresh]);
  });
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- HTML 보고서 다운로드 (F06) ----------
async function downloadHtml() {
  if (!state.css) state.css = await fetch("report.css?v=2").then((r) => r.text()).catch(() => "");
  const r = state.result.report;
  const html = standaloneHTML(buildReport(state.result, state.answers), state.css, `분석 보고서 — ${r.task_name}`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  a.download = `분석보고서_${r.task_name.replace(/[\\/:*?"<>|]/g, "_")}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 샘플 ----------
function selectedCase() { return state.cases.find((c) => c.id === $("sampleSelect").value); }
function loadSample() {
  const c = selectedCase(); if (!c) return;
  $("taskName").value = c.task_name; $("problem").value = c.problem; $("improvement").value = c.improvement;
  state.answers = []; clearMessages();
}
function showSampleResult() {
  const c = selectedCase(); if (!c) return;
  const s = state.samples[c.id];
  loadSample();
  if (!s) return showMessage("warn", "이 사례는 미리 실행해 둔 결과가 없습니다. API 키를 입력하고 직접 분석해 보세요.");
  state.result = { report: structuredClone(s.report), guardrail_log: s.guardrail_log, elapsed_sec: s.metrics.elapsed_sec,
    model: `${s.metrics.model || "gemini-3.8-flash"} (사전 실행)`, date: "2026-11-17", usage: {}, mode: "sample" };
  renderResult(0);
}

// ---------- 초기화 ----------
async function init() {
  $("model").innerHTML = MODELS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("");
  const saved = storage.get(KEY_STORE);
  if (saved) { $("apiKey").value = saved; $("rememberKey").checked = true; }
  state.view = storage.get(VIEW_STORE) || "paged";
  $("rememberKey").addEventListener("change", rememberKey);
  $("model").addEventListener("change", () => {
    $("modelHint").textContent = $("model").value === "auto"
      ? "한도 초과·혼잡 시 다음 무료 모델로 자동 전환합니다." : "선택한 모델만 사용합니다. 실패하면 '자동 선택'을 권장합니다.";
  });
  $("requestForm").addEventListener("submit", (e) => { e.preventDefault(); runAnalysis([]); });
  $("loadSample").addEventListener("click", loadSample);
  $("showSampleResult").addEventListener("click", showSampleResult);
  try {
    const [cases, samples] = await Promise.all([fetch("data/test_cases.json").then((r) => r.json()), fetch("data/sample_results.json").then((r) => r.json()).catch(() => ({}))]);
    state.cases = cases; state.samples = samples;
    $("sampleSelect").innerHTML = cases.map((c) => `<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.title)}</option>`).join("");
  } catch {
    $("sampleSelect").innerHTML = "<option>샘플을 불러오지 못했습니다</option>";
  }
}
init();
