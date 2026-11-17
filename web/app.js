// AI 업무 개선 요청 분석 Assistant — 브라우저 버전 (GitHub Pages)
// Python(Google ADK) 버전과 같은 프롬프트·스키마(config.js, 자동 생성)·가드레일 규칙을 사용한다.
// 방문자가 입력한 Gemini API 키로 브라우저에서 Google API를 직접 호출한다.
import { MODELS, AnalysisError, storage, validateInput, buildUserMessage, sourceText, callWithFallback, applyGuardrails } from "./core.js?v=2";
import { buildReport, standaloneHTML, esc, STEPS } from "./report.js?v=2";

const $ = (id) => document.getElementById(id);
const KEY_STORE = "mq2_gemini_key";
const VIEW_STORE = "mq2_view";

const state = { cases: [], samples: {}, result: null, answers: [], lastArgs: null, busy: false, view: "paged", step: 0, css: null };

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
