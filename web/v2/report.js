// v2 보고서 마크업 — 화면 오른쪽 카드와 HTML 다운로드 파일이 함께 사용한다.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const st = (s) => `<span class="st ${esc(s)}">${esc(s)}</span>`;
const pad = (n) => String(n).padStart(2, "0");
const NON_DEV = new Set(["프로세스 개선", "교육/가이드"]);
const REF_ORDER = ["요청과 차이", "규정 근거", "개선 제약", "문서 미비"];
const REF_HELP = {
  "요청과 차이": "문서상 절차와 요청자가 설명한 실제 업무가 다른 점",
  "규정 근거": "문제나 절차를 뒷받침하는 문서 조항",
  "개선 제약": "개선 시 지켜야 하거나 개정이 필요한 규정",
  "문서 미비": "문서에 정의되지 않아 혼선이 생길 수 있는 부분",
};

function ev(f) {
  if (!f.evidence) return "";
  if (f.status !== "확인") return `<span class="r2-ev">판단 근거: ${esc(f.evidence)}</span>`;
  return f.source_doc
    ? `<span class="r2-ev doc">문서 근거 · ${esc(f.source_doc)}: 「${esc(f.evidence)}」</span>`
    : `<span class="r2-ev">입력 근거: 「${esc(f.evidence)}」</span>`;
}
function items(list) {
  if (!list?.length) return `<p class="r2-empty">해당 내용이 없습니다.</p>`;
  return `<ul class="r2-items">${list.map((f) => `<li class="r2-item"><div class="line">${st(f.status)}${f.source_doc ? `<span class="docmark" title="${esc(f.source_doc)}">문서</span>` : ""}${esc(f.content)}</div>${ev(f)}</li>`).join("")}</ul>`;
}

// 참고 문서가 있으면 '참고 문서 검토' 섹션을 넣고 번호를 다시 매긴다.
function sectionList(hasDocs) {
  return [
    ["r2-s1", "업무 개요", "요청 요약"],
    ["r2-s2", "현재 업무 방식", "AS-IS"],
    ["r2-s3", "주요 문제점", "입력 근거"],
    ...(hasDocs ? [["r2-sd", "참고 문서 검토", "SOP · 규정 대조"]] : []),
    ["r2-s4", "개선 목적 및 기대 효과", ""],
    ["r2-s5", "개선 업무 흐름과 후보", "TO-BE · 검토 필요"],
    ["r2-s6", "추가 확인 질문", "누락 정보"],
    ["r2-s7", "분석 근거 및 미확인 사항", "자동 검증"],
  ];
}

// opts.answerInputs: 질문마다 답변 입력칸을 넣을지 (화면용 true, 다운로드용 false)
export function buildReport(result, answers = [], opts = {}) {
  const r = result.report;
  const docs = result.documents || [];
  const hasDocs = docs.length > 0 || (r.reference_findings || []).length > 0;
  const SECTIONS = sectionList(hasDocs);
  const idx = Object.fromEntries(SECTIONS.map(([id], i) => [id, i]));
  const sec = (id, body) => {
    const [, title, sub] = SECTIONS[idx[id]];
    return `<section class="r2-sec" id="${id}"><h3><span class="no">${pad(idx[id] + 1)}</span>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</h3>${body}</section>`;
  };

  const facts = [r.task_purpose, ...(r.as_is_process || []), ...(r.problems || []), ...(r.improvement_goals || []), ...(r.expected_effects || [])].filter(Boolean);
  const confirmed = facts.filter((f) => f.status === "확인").length;
  const fromDocs = facts.filter((f) => f.source_doc).length;
  const flow = (r.as_is_process || []).map((s) => `<li class="${esc(s.status)}${s.source_doc ? " fromdoc" : ""}">${esc(s.step)}</li>`).join(`<li class="arw" aria-hidden="true">→</li>`);
  const legend = `<p class="r2-legend">${st("확인")}입력·문서에 명시됨 ${st("추정")}AI가 추론 ${st("미확인")}정보 없음${hasDocs ? ` <span class="docmark">문서</span>참고 문서 근거` : ""}</p>`;

  const head = `<div class="r2-title">${esc(r.task_name)}</div>
    <div class="r2-meta"><span>${esc(result.date || new Date().toLocaleString("ko-KR"))}</span><span>${esc(result.model)}</span><span>분석 ${esc(result.elapsed_sec)}초</span>${docs.length ? `<span>참고 문서 ${docs.length}건</span>` : ""}${answers.length ? `<span>추가 답변 ${answers.length}건 반영</span>` : ""}</div>
    <p class="r2-lead">${esc(r.summary)}</p>
    <div class="r2-stats"><div class="r2-stat"><b>${(r.problems || []).length}</b><span>주요 문제점</span></div>
      ${hasDocs ? `<div class="r2-stat"><b>${(r.reference_findings || []).length}</b><span>문서 검토 항목</span></div>` : `<div class="r2-stat"><b>${(r.candidates || []).length}</b><span>개선 후보</span></div>`}
      <div class="r2-stat"><b>${(r.questions || []).length}</b><span>추가 확인 질문</span></div>
      <div class="r2-stat"><b>${confirmed}/${facts.length}</b><span>${hasDocs ? `확인된 사실 (문서 ${fromDocs})` : "원문 확인 사실"}</span></div></div>
    <p class="r2-note">AI가 작성한 검토용 초안입니다. 개선 후보는 최종 결정이 아니며, '추정'·'미확인' 항목은 현업에 확인해야 합니다.${hasDocs ? " 참고 문서와 실제 업무가 다를 수 있으므로 '요청과 차이' 항목을 먼저 확인하세요." : ""}</p>
    <ol class="r2-toc">${SECTIONS.map(([id, t], i) => `<li><a href="#${id}"><b>${pad(i + 1)}</b>${esc(t)}</a></li>`).join("")}</ol>`;

  const parts = [];
  parts.push(sec("r2-s1", `<p>${esc(r.summary)}</p><h4>업무 목적</h4>${items([r.task_purpose])}`));
  parts.push(sec("r2-s2", `${legend}<ol class="r2-flow">${flow}</ol><p>${esc(r.as_is_description)}</p>
    ${items((r.as_is_process || []).map((s) => ({ content: `${s.order}. ${s.step}`, status: s.status, evidence: s.evidence, source_doc: s.source_doc })))}`));
  parts.push(sec("r2-s3", items(r.problems)));
  if (hasDocs) {
    const refs = r.reference_findings || [];
    const groups = REF_ORDER.map((t) => [t, refs.filter((x) => x.type === t)]).filter(([, l]) => l.length);
    const docList = docs.length ? `<p class="r2-docs">${docs.map((d) => `<span class="r2-doc">${esc(d.kind)} · ${esc(d.name)}${d.chars ? ` <small>${Number(d.chars).toLocaleString()}자</small>` : ""}</span>`).join("")}</p>` : "";
    parts.push(sec("r2-sd", `${docList}${groups.length ? groups.map(([t, l]) => `<h4 class="ref-h ref-${esc(t.replace(/\s/g, ""))}">${esc(t)} <span>${esc(REF_HELP[t])}</span></h4>
      <ul class="r2-items">${l.map((x) => `<li class="r2-item"><div class="line">${esc(x.content)}</div>${x.evidence ? `<span class="r2-ev doc">${esc(x.doc)}: 「${esc(x.evidence)}」</span>` : `<span class="r2-ev">${esc(x.doc)}</span>`}</li>`).join("")}</ul>`).join("")
      : `<p class="r2-empty">참고 문서에서 요청과 관련된 특이 사항을 찾지 못했습니다.</p>`}`));
  }
  parts.push(sec("r2-s4", `<h4>개선 목적</h4>${items(r.improvement_goals)}<h4>기대 효과</h4>${items(r.expected_effects)}`));
  parts.push(sec("r2-s5", `<div class="r2-compare"><div class="asis"><b>AS-IS · 현재</b>${esc(r.as_is_description)}</div><div class="tobe"><b>TO-BE · 제안 (가안)</b>${esc(r.to_be_concept)}</div></div>
    <h4>개선 후보 · 검토 필요</h4><ul class="r2-items">${(r.candidates || []).map((c) => `<li class="r2-cand"><div class="line"><span class="lbl ${NON_DEV.has(c.type) ? "alt" : ""}">[${NON_DEV.has(c.type) ? "비개발 대안" : "검토 후보"}]</span>${esc(c.title)}</div>
      <small>${esc(c.type)} · ${esc(c.description)}</small><dl><dt>해결 대상</dt><dd>${esc(c.related_problem)}</dd><dt>기대 효과</dt><dd>${esc(c.expected_effect)}</dd><dt>전제 조건</dt><dd>${esc(c.prerequisite)}</dd></dl></li>`).join("")}</ul>`));
  const qs = (r.questions || []).length
    ? `<ol class="r2-items qs">${r.questions.map((q, i) => `<li class="r2-q"><div><div class="line">${esc(q.question)}</div><small><span class="cat">${esc(q.category)}</span> · ${esc(q.reason)}</small></div>${
      opts.answerInputs ? `<input type="text" data-q="${esc(q.question)}" aria-label="질문 ${i + 1} 답변" placeholder="알고 있다면 답변을 적어 주세요 (선택)">` : ""}</li>`).join("")}</ol>
      ${opts.answerInputs ? `<button type="button" class="secondary" id="reanalyzeBtn" style="margin-top:14px">답변 반영하여 다시 분석</button>` : ""}`
    : `<p class="r2-empty">추가 질문이 없습니다.</p>`;
  parts.push(sec("r2-s6", qs + (answers.length ? `<h4>반영된 추가 답변</h4><ul class="r2-items">${answers.map((a) => `<li class="r2-item"><div class="line">${esc(a.question)}</div><small>답변: ${esc(a.answer)}</small></li>`).join("")}</ul>` : "")));
  const log = result.guardrail_log || [];
  parts.push(sec("r2-s7", `<p>${esc(r.analysis_basis)}</p>${docs.length ? `<h4>참고한 문서</h4><ul>${docs.map((d) => `<li>${esc(d.name)} (${esc(d.kind)})</li>`).join("")}</ul>` : ""}
    <h4>미확인 사항</h4>${(r.unconfirmed || []).length ? `<ul>${r.unconfirmed.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : `<p class="r2-empty">없음</p>`}
    <h4>자동 검증 교정 내역</h4>${log.length ? `<table class="r2-guard"><thead><tr><th>유형</th><th>위치</th><th>내용</th></tr></thead><tbody>${log.map((g) => `<tr><td>${esc(g.type)}</td><td>${esc(g.where)}</td><td>${esc(g.content)}</td></tr>`).join("")}</tbody></table>` : `<p class="r2-empty">원문 근거가 없는 '확인' 항목이나 중복 질문이 발견되지 않았습니다.</p>`}`));

  return `<div class="r2">${head}${parts.join("")}</div>`;
}

export function standaloneHTML(result, answers, css) {
  const title = `분석 보고서 — ${result.report.task_name}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${css}</style></head>
<body class="r2-standalone"><div class="r2-page"><div class="r2-brandbar"><b>AI Business Improvement Assistant</b><span>업무 개선 요청 분석 보고서</span></div>
<div class="r2-card"><div class="eyebrow">ANALYSIS REPORT</div>${buildReport(result, answers)}<div class="r2-foot"><span>AI Business Improvement Assistant · Main Quest 02</span><span>검토용 초안 — 사람의 검토가 필요합니다</span></div></div></div></body></html>`;
}
