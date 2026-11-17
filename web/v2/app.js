// v2 화면 — 분석 로직은 기본 사이트와 같은 ../core.js 를 사용하고, 화면 구성만 다르다.
import { MODELS, storage, validateInput, buildUserMessage, sourceText, callWithFallback, applyGuardrails } from "../core.js?v=2";
import { buildReport, standaloneHTML, esc } from "./report.js?v=2";
import { ACCEPT, MAX_FILES, DOC_KINDS, readDocument, checkSize } from "../docs.js?v=1";

const $ = (id) => document.getElementById(id);
const KEY_STORE = "mq2_gemini_key"; // 기본 사이트와 같은 키 저장소(같은 브라우저에서 공유)
const STAGES = ["입력 검증", "현재 업무와 핵심 문제 구조화", "누락 정보 확인 · 질문 생성", "입력 근거 검증 (가드레일)"];
const state = { cases: [], samples: {}, result: null, answers: [], lastArgs: null, busy: false, css: null, timer: null, docs: [] };

// ---------- 상태 표시 ----------
function setPill(text, kind = "") { const p = $("statusPill"); p.textContent = text; p.className = `pill ${kind}`; }
function body(html) { $("resultBody").innerHTML = html; }
function stopTimer() { clearInterval(state.timer); state.timer = null; }

function renderEmpty(alert = "") {
  stopTimer();
  setPill("검토 대기");
  body(`${alert}<div class="empty"><div class="empty-icon">▤</div>
    <h3>문제가 분명해야 개선도 분명해집니다.</h3><p>왼쪽에 업무 요청을 적으면 분석 결과가 여기에 정리됩니다.</p>
    <div class="features">
      <div>01<strong>현재 업무와 핵심 문제</strong><span>입력에 적힌 근거로 확인 · 추정 · 미확인을 구분</span></div>
      <div>02<strong>개선 흐름과 검토 후보</strong><span>시스템 개발이 아닌 대안도 함께 제시</span></div>
      <div>03<strong>다음에 확인할 질문</strong><span>빠진 정보를 최대 10개 질문으로 정리</span></div>
    </div>
    <button type="button" class="secondary" id="previewBtn">샘플 보고서 미리보기 →</button>
    <small>미리 실행해 둔 실제 Gemini 분석 결과입니다. API 키 없이 볼 수 있습니다.</small></div>`);
  $("previewBtn").addEventListener("click", showSample);
}

function renderProgress(stage, note = "") {
  const t0 = state.t0;
  const draw = () => {
    body(`<div class="progress"><ol>${STAGES.map((s, i) => `<li class="${i < stage ? "done" : i === stage ? "now" : ""}"><span class="ic">${i < stage ? "✓" : ""}</span>${esc(s)}</li>`).join("")}</ol>
      <p class="elapsed">${note ? esc(note) + " · " : ""}경과 ${((performance.now() - t0) / 1000).toFixed(0)}초 · 보통 15~60초 걸립니다.</p></div>`);
  };
  stopTimer(); draw(); state.timer = setInterval(draw, 1000);
}

function alertBox(kind, html) { return `<div class="alert ${kind}">${html}</div>`; }

// ---------- 분석 ----------
async function runAnalysis(answers = []) {
  if (state.busy) return;
  const documents = state.docs.filter((d) => d.text).map(({ name, kind, text }) => ({ name, kind, text }));
  const args = { taskName: $("taskName").value, problem: $("problem").value, improvement: $("improvement").value, answers, documents };
  const errs = validateInput(args.taskName, args.problem);
  if (state.docs.some((d) => d.loading)) errs.push("참고 문서를 읽는 중입니다. 잠시 후 다시 눌러 주세요.");
  const tooBig = checkSize(documents);
  if (tooBig) errs.push(tooBig);
  if (errs.length) return showAlert("warn", errs.map(esc).join("<br>"));
  const key = $("apiKey").value.trim();
  if (!key) {
    $("connect").open = true; $("apiKey").focus();
    return showAlert("warn", `AI 분석을 하려면 <b>AI 분석 연결</b>에 무료 Gemini 키를 입력해 주세요. 키 없이 보려면 <b>샘플 보고서 미리보기</b>를 누르세요.`);
  }
  rememberKey();
  state.busy = true; state.lastArgs = args; $("analyzeBtn").disabled = true;
  state.t0 = performance.now();
  setPill("분석 중", "busy");
  renderProgress(1, documents.length ? `참고 문서 ${documents.length}건 포함` : "");
  try {
    const out = await callWithFallback(key, $("model").value, buildUserMessage(args), (m, tried) =>
      renderProgress(1, tried.length ? `${tried.at(-1).model} 사용 불가 → ${m}로 전환` : m));
    renderProgress(3);
    const log = applyGuardrails(out.report, sourceText(args), documents.map((d) => d.name));
    state.result = { report: out.report, guardrail_log: log, model: out.model, attempts: out.attempts,
      documents: documents.map((d) => ({ name: d.name, kind: d.kind, chars: d.text.length })),
      elapsed_sec: ((performance.now() - state.t0) / 1000).toFixed(1), mode: "live" };
    state.answers = answers;
    renderReport(out.attempts.length > 1 ? alertBox("info", `${esc(out.attempts.slice(0, -1).map((a) => a.model).join(", "))} 대신 <b>${esc(out.model)}</b>로 자동 전환해 분석했습니다.`) : "");
  } catch (e) {
    stopTimer();
    setPill("분석 실패");
    const retry = e.retryable !== false ? `<button type="button" class="secondary" id="retryBtn">다시 시도</button>` : "";
    if (state.result) renderReport(alertBox("err", `분석에 실패했습니다. ${esc(e.message)} ${retry}`));
    else renderEmpty(alertBox("err", `분석에 실패했습니다. ${esc(e.message)} ${retry}`));
    setPill("분석 실패");
    $("retryBtn")?.addEventListener("click", () => runAnalysis(state.lastArgs?.answers || []));
  } finally {
    state.busy = false; $("analyzeBtn").disabled = false;
  }
}

function showAlert(kind, html) {
  const host = $("resultBody");
  host.querySelector(".alert")?.remove();
  host.insertAdjacentHTML("afterbegin", alertBox(kind, html));
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- 보고서 ----------
function renderReport(alert = "") {
  stopTimer();
  const res = state.result;
  setPill(res.mode === "sample" ? "사전 실행 결과" : "AI 분석 완료", res.mode === "sample" ? "sample" : "done");
  const sample = res.mode === "sample" ? alertBox("info", "미리 실행해 둔 실제 Gemini 분석 결과입니다. 직접 분석하려면 <b>AI 분석 연결</b>에 키를 입력하세요.") : "";
  body(`${alert}${sample}${buildReport(res, state.answers, { answerInputs: res.mode !== "sample" })}
    <div class="report-actions"><button type="button" class="primary" id="downloadBtn"><span>보고서 내려받기 (HTML)</span><span>↓</span></button></div>`);
  $("downloadBtn").addEventListener("click", download);
  $("reanalyzeBtn")?.addEventListener("click", () => {
    const fresh = [...$("resultBody").querySelectorAll("input[data-q]")].filter((i) => i.value.trim()).map((i) => ({ question: i.dataset.q, answer: i.value.trim() }));
    if (!fresh.length) return showAlert("warn", "답변을 1개 이상 입력해 주세요.");
    runAnalysis([...state.answers, ...fresh]);
  });
  // 목차 링크: 결과 카드 안 섹션으로 이동
  $("resultBody").querySelectorAll(".r2-toc a").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  if (window.matchMedia("(max-width: 1000px)").matches) $("resultBody").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function download() {
  if (!state.css) state.css = await fetch("report.css?v=2").then((r) => r.text()).catch(() => "");
  const html = standaloneHTML(state.result, state.answers, state.css);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  a.download = `분석보고서_${state.result.report.task_name.replace(/[\\/:*?"<>|]/g, "_")}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 샘플 · 입력 ----------
async function fillCase(id) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  $("taskName").value = c.task_name; $("problem").value = c.problem; $("improvement").value = c.improvement;
  state.docs = [];
  for (const d of c.documents || []) { // 샘플 참고 문서 (가상 SOP·규정)
    const name = d.path.split("/").pop();
    try { state.docs.push({ name, kind: d.kind, text: await fetch(`../data/docs/${encodeURIComponent(name)}`).then((r) => r.ok ? r.text() : Promise.reject()) }); }
    catch { state.docs.push({ name, error: "샘플 문서를 불러오지 못했습니다." }); }
  }
  renderDocs();
}
async function showSample() {
  const id = $("sampleSelect").value || "T01";
  $("sampleSelect").value = id; await fillCase(id);
  const s = state.samples[id];
  if (!s) return showAlert("warn", "이 사례는 미리 실행해 둔 결과가 없습니다.");
  state.answers = [];
  state.result = { report: structuredClone(s.report), guardrail_log: s.guardrail_log, elapsed_sec: s.metrics.elapsed_sec, documents: s.documents || [],
    model: `${s.metrics.model || "gemini-3.8-flash"} · 사전 실행`, date: "2026-11-17", mode: "sample" };
  renderReport();
}
function rememberKey() {
  if ($("rememberKey").checked) storage.set(KEY_STORE, $("apiKey").value.trim()); else storage.del(KEY_STORE);
}
function updateKeyState() {
  const ok = !!$("apiKey").value.trim();
  $("keyState").textContent = ok ? "키 입력됨" : "키 미입력";
  $("keyState").className = `state ${ok ? "ok" : ""}`;
}
function reset() {
  $("requestForm").reset(); $("sampleSelect").value = "";
  const saved = storage.get(KEY_STORE);
  if (saved) { $("apiKey").value = saved; $("rememberKey").checked = true; }
  updateKeyState();
  state.result = null; state.answers = []; state.docs = []; renderDocs();
  renderEmpty();
}

// ---------- 참고 문서 ----------
function renderDocs() {
  const kindOpts = (k) => DOC_KINDS.map((x) => `<option ${x === k ? "selected" : ""}>${esc(x)}</option>`).join("");
  $("docList").innerHTML = state.docs.map((d, i) => d.loading
    ? `<li class="loading"><span>⏳</span><span class="nm">${esc(d.name)} <small>읽는 중…</small></span><span></span><span></span></li>`
    : d.error
      ? `<li class="err"><span>⚠️</span><span class="nm">${esc(d.name)} <small>${esc(d.error)}</small></span><button type="button" class="rm" data-i="${i}" aria-label="삭제">✕</button></li>`
      : `<li><span>📄</span><span class="nm" title="${esc(d.name)}">${esc(d.name)} <small>${d.text.length.toLocaleString()}자</small></span>
          <select data-i="${i}" aria-label="문서 종류">${kindOpts(d.kind)}</select><button type="button" class="rm" data-i="${i}" aria-label="${esc(d.name)} 삭제">✕</button></li>`).join("");
  $("docList").querySelectorAll(".rm").forEach((b) => b.addEventListener("click", () => { state.docs.splice(+b.dataset.i, 1); renderDocs(); }));
  $("docList").querySelectorAll("select").forEach((sel) => sel.addEventListener("change", () => { state.docs[+sel.dataset.i].kind = sel.value; }));
}

async function addFiles(files) {
  const list = [...files];
  const room = MAX_FILES - state.docs.length;
  if (list.length > room) showAlert("warn", `참고 문서는 최대 ${MAX_FILES}개까지 추가할 수 있습니다.`);
  for (const f of list.slice(0, Math.max(0, room))) {
    const item = { name: f.name, loading: true };
    state.docs.push(item); renderDocs();
    try { Object.assign(item, await readDocument(f), { loading: false }); }
    catch (e) { Object.assign(item, { loading: false, error: e.message }); }
    renderDocs();
  }
}

function initDocs() {
  $("docInput").accept = ACCEPT;
  $("pasteKind").innerHTML = DOC_KINDS.map((k) => `<option>${esc(k)}</option>`).join("");
  $("docPick").addEventListener("click", () => $("docInput").click());
  $("docInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  const drop = $("docDrop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
  $("docPasteToggle").addEventListener("click", () => { $("docPaste").hidden = !$("docPaste").hidden; if (!$("docPaste").hidden) $("pasteName").focus(); });
  $("pasteAdd").addEventListener("click", () => {
    const text = $("pasteText").value.trim();
    if (!text) return showAlert("warn", "붙여넣을 문서 내용을 입력해 주세요.");
    if (state.docs.length >= MAX_FILES) return showAlert("warn", `참고 문서는 최대 ${MAX_FILES}개까지 추가할 수 있습니다.`);
    state.docs.push({ name: $("pasteName").value.trim() || `붙여넣은 문서 ${state.docs.length + 1}`, kind: $("pasteKind").value, text });
    $("pasteName").value = ""; $("pasteText").value = ""; $("docPaste").hidden = true;
    renderDocs();
  });
}

async function init() {
  $("model").innerHTML = MODELS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("");
  const saved = storage.get(KEY_STORE);
  if (saved) { $("apiKey").value = saved; $("rememberKey").checked = true; }
  updateKeyState();
  $("apiKey").addEventListener("input", updateKeyState);
  $("rememberKey").addEventListener("change", rememberKey);
  $("requestForm").addEventListener("submit", (e) => { e.preventDefault(); runAnalysis([]); });
  $("resetBtn").addEventListener("click", reset);
  $("sampleSelect").addEventListener("change", () => { if ($("sampleSelect").value) fillCase($("sampleSelect").value); });
  initDocs();
  renderEmpty();
  try {
    const [cases, samples] = await Promise.all([fetch("../data/test_cases.json").then((r) => r.json()), fetch("../data/sample_results.json").then((r) => r.json()).catch(() => ({}))]);
    state.cases = cases; state.samples = samples;
    $("sampleSelect").insertAdjacentHTML("beforeend", cases.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join(""));
  } catch { /* 샘플 없이도 직접 입력은 가능 */ }
}
init();
