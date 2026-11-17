// AI 업무 개선 요청 분석 Assistant — 브라우저 버전 (GitHub Pages)
// Python(Google ADK) 버전과 같은 프롬프트·스키마(config.js, 자동 생성)·가드레일 규칙을 사용한다.
// 방문자가 입력한 Gemini API 키로 브라우저에서 Google API를 직접 호출한다.
import { SYSTEM_PROMPT, REPORT_SCHEMA } from "./config.js";

const $ = (id) => document.getElementById(id);
const BADGE = { "확인": "✅ 확인", "추정": "🟡 추정", "미확인": "⚪ 미확인" };
const DISCLAIMER = "⚠️ 본 보고서는 AI가 생성한 검토용 초안입니다. 개선 후보는 최종 결정이 아니며, IT 담당자/BA의 검토가 필요합니다. '추정'·'미확인' 항목은 반드시 현업에 확인하세요.";
const MAX_QUESTIONS = 10;
const KEY_STORE = "mq2_gemini_key";

const state = { cases: [], samples: {}, result: null, answers: [], lastArgs: null, busy: false };

class AnalysisError extends Error {
  constructor(message, retryable = true) { super(message); this.retryable = retryable; }
}

// ---------- 유틸 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badge = (st) => `<span class="badge b-${esc(st)}">${esc(BADGE[st] || st)}</span>`;
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
    throw new AnalysisError("AI 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = JSON.stringify(data);
    if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/.test(msg) || res.status === 401 || res.status === 403)
      throw new AnalysisError("Gemini API 키가 올바르지 않습니다. 왼쪽 설정에서 키를 확인해 주세요.", false);
    if (res.status === 429) throw new AnalysisError("무료 사용량 한도(분당/일일 요청 수)를 초과했습니다. 잠시 후 다시 시도하거나 모델을 flash-lite로 바꿔 보세요.");
    if (res.status === 404) throw new AnalysisError(`모델 '${model}'을(를) 찾을 수 없습니다. 다른 모델을 선택해 주세요.`, false);
    if (res.status >= 500) throw new AnalysisError("Gemini 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.");
    throw new AnalysisError(`요청 오류(HTTP ${res.status}): ${data?.error?.message || ""}`, false);
  }
  const cand = data.candidates?.[0];
  if (!cand) throw new AnalysisError("AI가 이 요청에 응답하지 않았습니다(안전 정책 등). 내용을 수정해 다시 시도해 주세요.", false);
  if (cand.finishReason === "MAX_TOKENS") throw new AnalysisError("분석 결과가 너무 길어 중간에 끊겼습니다. 입력을 줄여 다시 시도해 주세요.");
  if (cand.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(cand.finishReason))
    throw new AnalysisError(`AI가 응답을 완료하지 못했습니다(${cand.finishReason}). 내용을 수정해 다시 시도해 주세요.`, false);
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  let report;
  try { report = JSON.parse(text); } catch { throw new AnalysisError("AI 응답을 보고서 형식으로 해석하지 못했습니다. 다시 시도해 주세요."); }
  const u = data.usageMetadata || {};
  return { report, usage: { input_tokens: u.promptTokenCount, output_tokens: u.candidatesTokenCount } };
}

async function withRetry(fn, onWait, waits = [5, 15]) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof AnalysisError) || !e.retryable || i >= waits.length) throw e;
      onWait?.(waits[i]);
      await new Promise((r) => setTimeout(r, waits[i] * 1000));
    }
  }
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

// ---------- 분석 실행 ----------
async function runAnalysis(answers) {
  if (state.busy) return;
  const args = { taskName: $("taskName").value, problem: $("problem").value, improvement: $("improvement").value, answers };
  const errs = validateInput(args.taskName, args.problem);
  if (errs.length) return showMessage("err", errs.join("<br>"));
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) return showMessage("warn", `Gemini API 키를 왼쪽 설정에 입력해 주세요. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">무료 발급</a> · 키 없이 보려면 <b>결과 미리보기</b>를 누르세요.`);
  rememberKey();
  const model = $("model").value;
  state.lastArgs = args;
  setBusy(true);
  showMessage("info", `<div class="progress"><div class="spinner"></div><div>AI Assistant가 요청을 분석하고 있습니다… <b>${esc(model)}</b> (보통 10~60초)<br><small>① 입력 검증 완료 → ② 요구사항 구조화 · 누락 정보 식별 · 질문 생성 중…</small></div></div>`);
  const t0 = performance.now();
  try {
    const { report, usage } = await withRetry(() => callGemini(apiKey, model, buildUserMessage(args)),
      (s) => showMessage("warn", `Gemini가 일시적으로 바쁩니다. ${s}초 후 자동으로 다시 시도합니다…`));
    const log = applyGuardrails(report, sourceText(args));
    state.result = { report, guardrail_log: log, elapsed_sec: ((performance.now() - t0) / 1000).toFixed(1), model, usage, mode: "live" };
    state.answers = answers || [];
    clearMessages();
    renderResult();
  } catch (e) {
    const retry = e.retryable !== false ? ` <button type="button" class="secondary" id="retryBtn">🔁 다시 시도</button>` : "";
    showMessage("err", `분석에 실패했습니다. ${esc(e.message)}${retry}`);
    $("retryBtn")?.addEventListener("click", () => runAnalysis(state.lastArgs?.answers || []));
  } finally {
    setBusy(false);
  }
}

function setBusy(b) {
  state.busy = b;
  $("analyzeBtn").disabled = b;
  $("analyzeBtn").textContent = b ? "분석 중…" : "🔍 분석하기";
}
function showMessage(kind, html) { $("messages").innerHTML = `<div class="msg ${kind}">${html}</div>`; }
function clearMessages() { $("messages").innerHTML = ""; }

function rememberKey() {
  if ($("rememberKey").checked) storage.set(KEY_STORE, $("apiKey").value.trim());
  else storage.del(KEY_STORE);
}

// ---------- 화면 렌더링 (F04) ----------
function findingTable(items) {
  const rows = (items || []).map((f) => `<tr><td>${badge(f.status)}</td><td>${esc(f.content)}</td><td>${esc(f.evidence) || "-"}</td></tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr><th>상태</th><th>내용</th><th>근거</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderResult() {
  const res = state.result, r = res.report;
  const sampleNote = res.mode === "sample"
    ? `<div class="msg info">📂 미리 실행해 둔 <b>Gemini 분석 결과</b>(${esc(res.model)}, 분석 시간 ${esc(res.elapsed_sec)}초)입니다. 직접 분석하려면 API 키를 입력하고 <b>분석하기</b>를 누르세요.</div>` : "";
  const steps = (r.as_is_process || []).map((s) => `<span class="step">${esc(s.step)} ${badge(s.status)}</span>`).join(" → ");
  const stepRows = (r.as_is_process || []).map((s) => `<tr><td>${esc(s.order)}</td><td>${esc(s.step)}</td><td>${badge(s.status)}</td><td>${esc(s.evidence) || "-"}</td></tr>`).join("");
  const cands = (r.candidates || []).map((c, i) => `<details ${i === 0 ? "open" : ""}><summary>후보 ${i + 1}. ${esc(c.title)}<span class="tag">${esc(c.type)}</span></summary>
      <p>${esc(c.description)}</p><ul><li><b>해결 대상 문제</b>: ${esc(c.related_problem)}</li><li><b>기대 효과</b>: ${esc(c.expected_effect)}</li><li><b>검토 전 전제 조건</b>: ${esc(c.prerequisite)}</li></ul></details>`).join("");
  const qs = (r.questions || []).map((q) => `<li><span class="tag">${esc(q.category)}</span> ${esc(q.question)}<small>└ ${esc(q.reason)}</small></li>`).join("") || "<li>추가 질문 없음</li>";
  const unconf = (r.unconfirmed || []).map((u) => `<li>⚪ ${esc(u)}</li>`).join("");
  const guard = res.guardrail_log.length
    ? `<details><summary>🛡️ 자동 검증(가드레일) 교정 내역 ${res.guardrail_log.length}건</summary><div class="table-wrap"><table><thead><tr><th>유형</th><th>위치</th><th>내용</th></tr></thead><tbody>${res.guardrail_log.map((g) => `<tr><td>${esc(g.type)}</td><td>${esc(g.where)}</td><td>${esc(g.content)}</td></tr>`).join("")}</tbody></table></div></details>` : "";
  const answerForm = (r.questions || []).length ? `<form id="answerForm" class="answers"><p>알고 있는 항목만 답해 주세요. 답변을 반영해 보고서를 다시 분석합니다.</p>
      ${r.questions.map((q, i) => `<label for="ans${i}">${i + 1}. [${esc(q.category)}] ${esc(q.question)}</label><input type="text" id="ans${i}" data-q="${esc(q.question)}">`).join("")}
      <button class="primary" type="submit">🔄 답변 반영하여 보고서 갱신</button></form>` : "<p>추가 질문이 없습니다.</p>";
  const prevAnswers = state.answers.length ? `<h4>지금까지 반영된 답변</h4><ul>${state.answers.map((a) => `<li>Q. ${esc(a.question)}<br>A. ${esc(a.answer)}</li>`).join("")}</ul>` : "";

  $("result").innerHTML = `<article class="panel report">
    <h2>📄 분석 보고서 — ${esc(r.task_name)}</h2>
    ${sampleNote}<div class="msg warn">${DISCLAIMER}</div>
    <div class="metrics">
      <div class="metric"><b>${esc(res.elapsed_sec)}초</b><span>분석 시간</span></div>
      <div class="metric"><b>${(r.problems || []).length}</b><span>주요 문제점</span></div>
      <div class="metric"><b>${(r.candidates || []).length}</b><span>개선 후보</span></div>
      <div class="metric"><b>${(r.questions || []).length}</b><span>추가 질문</span></div>
      <div class="metric"><b>${res.guardrail_log.length}</b><span>자동 교정</span></div>
    </div>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-tab="t-report">📋 보고서</button>
      <button role="tab" aria-selected="false" data-tab="t-answer">❓ 추가 질문 답변</button>
      <button role="tab" aria-selected="false" data-tab="t-md">⬇️ 다운로드</button>
    </div>
    <section class="tabpanel" id="t-report">
      <h3>1. 업무 개요</h3><p>${esc(r.summary)}</p>
      <p><b>업무 목적</b>: ${badge(r.task_purpose?.status)} ${esc(r.task_purpose?.content)}</p>
      <h3>2. 현재 업무 방식 (AS-IS)</h3><p>${esc(r.as_is_description)}</p>
      <div class="flow">${steps}</div>
      <div class="table-wrap"><table><thead><tr><th>순서</th><th>업무 단계</th><th>상태</th><th>근거</th></tr></thead><tbody>${stepRows}</tbody></table></div>
      <h3>3. 주요 문제점</h3>${findingTable(r.problems)}
      <h3>4. 개선 목적 및 기대 효과</h3><p><b>개선 목적</b></p>${findingTable(r.improvement_goals)}<p><b>기대 효과</b></p>${findingTable(r.expected_effects)}
      <h3>5. 개선 후 모습 (TO-BE, 검토용 가안)</h3><p>${esc(r.to_be_concept)}</p>
      <h3>6. 개선 후보 (검토 후보)</h3>${cands}
      <h3>7. 추가 확인 질문</h3><ol class="questions">${qs}</ol>
      <h3>8. 분석 근거 및 미확인 사항</h3><p>${esc(r.analysis_basis)}</p><ul>${unconf}</ul>${guard}
    </section>
    <section class="tabpanel" id="t-answer" hidden>${answerForm}${prevAnswers}</section>
    <section class="tabpanel" id="t-md" hidden>
      <button class="primary" type="button" id="downloadMd">⬇️ Markdown 보고서 다운로드</button>
      <pre class="md" id="mdPreview"></pre>
    </section>
  </article>`;

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".tabpanel").forEach((p) => { p.hidden = p.id !== b.dataset.tab; });
  }));
  const md = toMarkdown();
  $("mdPreview").textContent = md;
  $("downloadMd").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    a.download = `분석보고서_${r.task_name}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("answerForm")?.addEventListener("submit", (ev) => { // F05
    ev.preventDefault();
    const fresh = [...ev.target.querySelectorAll("input[data-q]")].filter((i) => i.value.trim())
      .map((i) => ({ question: i.dataset.q, answer: i.value.trim() }));
    if (!fresh.length) return showMessage("warn", "최소 1개 이상 답변을 입력해 주세요.");
    runAnalysis([...state.answers, ...fresh]);
  });
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Markdown 보고서 (F06, agent/report.py 와 동일 형식) ----------
function toMarkdown() {
  const res = state.result, r = res.report, cell = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const ft = (items) => ["| 상태 | 내용 | 근거 |", "|---|---|---|", ...(items || []).map((f) => `| ${BADGE[f.status]} | ${cell(f.content)} | ${cell(f.evidence) || "-"} |`)].join("\n");
  const L = [`# 업무 개선 요청 분석 보고서 — ${r.task_name}`, "", `- 작성일시: ${new Date().toLocaleString("ko-KR")}`,
    `- 분석 엔진: ${res.model} (AI 분석, 웹 버전)`, `- 추가 답변 반영: ${state.answers.length}건`, "", `> ${DISCLAIMER}`, "",
    "## 1. 업무 개요", r.summary, "", `**업무 목적**: ${BADGE[r.task_purpose?.status] || ""} ${r.task_purpose?.content || ""}`, "",
    "## 2. 현재 업무 방식 (AS-IS)", r.as_is_description, "", "| 순서 | 업무 단계 | 상태 | 근거 |", "|---|---|---|---|",
    ...(r.as_is_process || []).map((s) => `| ${s.order} | ${cell(s.step)} | ${BADGE[s.status]} | ${cell(s.evidence) || "-"} |`),
    "", "## 3. 주요 문제점", ft(r.problems), "", "## 4. 개선 목적 및 기대 효과", "**개선 목적**", ft(r.improvement_goals), "",
    "**기대 효과**", ft(r.expected_effects), "", "## 5. 개선 후 모습 (TO-BE, 검토용 가안)", r.to_be_concept, "", "## 6. 개선 후보 (검토 후보)"];
  (r.candidates || []).forEach((c, i) => L.push(`### 후보 ${i + 1}. ${c.title} \`${c.type}\``, c.description, "",
    `- 해결 대상 문제: ${c.related_problem}`, `- 기대 효과: ${c.expected_effect}`, `- 검토 전 전제 조건: ${c.prerequisite}`, ""));
  L.push("## 7. 추가 확인 질문", ...((r.questions || []).length ? r.questions.map((q, i) => `${i + 1}. **[${q.category}]** ${q.question}  \n   └ 필요한 이유: ${q.reason}`) : ["(추가 질문 없음)"]));
  if (state.answers.length) L.push("", "### 반영된 추가 답변", ...state.answers.map((a) => `- Q. ${a.question}  \n  A. ${a.answer}`));
  L.push("", "## 8. 분석 근거 및 미확인 사항", r.analysis_basis, "", "**미확인 사항**", ...((r.unconfirmed || []).length ? r.unconfirmed.map((u) => `- ${u}`) : ["- 없음"]));
  if (res.guardrail_log.length) L.push("", "**자동 검증(가드레일) 교정 내역**", ...res.guardrail_log.map((g) => `- ${g.type} — ${g.where}: ${cell(g.content)}`));
  return L.join("\n") + "\n";
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
  state.result = { report: structuredClone(s.report), guardrail_log: s.guardrail_log, elapsed_sec: s.metrics.elapsed_sec, model: "Gemini (사전 실행)", usage: {}, mode: "sample" };
  renderResult();
}

// ---------- 초기화 ----------
async function init() {
  const saved = storage.get(KEY_STORE);
  if (saved) { $("apiKey").value = saved; $("rememberKey").checked = true; }
  $("rememberKey").addEventListener("change", rememberKey);
  $("requestForm").addEventListener("submit", (e) => { e.preventDefault(); runAnalysis([]); });
  $("loadSample").addEventListener("click", loadSample);
  $("showSampleResult").addEventListener("click", showSampleResult);
  try {
    const [cases, samples] = await Promise.all([fetch("data/test_cases.json").then((r) => r.json()), fetch("data/sample_results.json").then((r) => r.json()).catch(() => ({}))]);
    state.cases = cases; state.samples = samples;
    $("sampleSelect").innerHTML = cases.map((c) => `<option value="${esc(c.id)}">${esc(c.id)} ${esc(c.title)}</option>`).join("");
  } catch {
    $("sampleSelect").innerHTML = "<option>샘플을 불러오지 못했습니다</option>";
  }
}
init();
