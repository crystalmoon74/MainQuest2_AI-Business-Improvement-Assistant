// 분석 보고서 HTML 생성 — 웹 화면과 HTML 다운로드가 같은 마크업을 쓴다.
// Python 버전(agent/html_report.py)도 같은 구조·클래스명(report.css)을 사용한다.

export const STEPS = [
  { id: "s1", short: "요청 요약", title: "업무 개요", lead: "요청 내용을 요약하고 업무 목적을 정리했습니다." },
  { id: "s2", short: "현재 업무", title: "현재 업무 방식 (AS-IS)", lead: "입력에서 확인되거나 추정되는 업무 절차입니다. 점선 단계는 추정·미확인입니다." },
  { id: "s3", short: "문제점", title: "주요 문제점", lead: "현재 업무에서 드러난 문제를 근거와 함께 정리했습니다." },
  { id: "s4", short: "목적·효과", title: "개선 목적 및 기대 효과", lead: "무엇을 위해 개선하고, 개선되면 무엇이 좋아지는지입니다." },
  { id: "s5", short: "개선 방향", title: "개선 방향 (TO-BE)과 개선 후보", lead: "개선 후 모습의 가안과 검토할 후보입니다. 최종 결정이 아닌 검토용입니다." },
  { id: "s6", short: "추가 질문", title: "추가 확인 질문", lead: "타당성 판단에 필요한 정보입니다. 답변하면 보고서가 갱신됩니다." },
  { id: "s7", short: "근거·검증", title: "분석 근거 및 미확인 사항", lead: "분석의 근거와 한계, 자동 검증으로 바로잡은 내역입니다." },
];

export const DISCLAIMER = "AI가 생성한 검토용 초안입니다. 개선 후보는 최종 결정이 아니며 IT 담당자·BA의 검토가 필요합니다. '추정'·'미확인' 항목은 반드시 현업에 확인하세요.";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const badge = (st) => `<span class="badge s-${esc(st)}">${esc(st)}</span>`;
const tagClass = (t) => "t-" + String(t || "").replace(/[\s/]/g, "");
const pad = (n) => String(n).padStart(2, "0");

function facts(items) {
  if (!items?.length) return `<p class="empty">해당 내용 없음</p>`;
  return `<div class="facts">${items.map((f) => `<div class="fact s-${esc(f.status)}">${badge(f.status)}<div class="content">${esc(f.content)}</div>${
    f.evidence ? `<div class="ev">${f.status === "확인" ? `원문 <q>${esc(f.evidence)}</q>` : `근거: ${esc(f.evidence)}`}</div>` : ""}</div>`).join("")}</div>`;
}

function slide(i, body) {
  const s = STEPS[i];
  return `<section class="slide" id="${s.id}" data-step="${i}"><header class="slide-head"><div class="slide-num">${pad(i + 1)}</div>
    <div class="slide-kicker">STEP ${i + 1} · ${esc(s.short)}</div><h2>${esc(s.title)}</h2><p class="slide-lead">${esc(s.lead)}</p></header>${body}</section>`;
}

export function buildReport(result, answers = []) {
  const r = result.report;
  const allFacts = [r.task_purpose, ...(r.as_is_process || []), ...(r.problems || []), ...(r.improvement_goals || []), ...(r.expected_effects || [])].filter(Boolean);
  const confirmed = allFacts.filter((f) => f.status === "확인").length;
  const date = result.date || new Date().toLocaleString("ko-KR");

  const cover = `<header class="rpt-cover">
    <div class="rpt-eyebrow">업무 개선 요청 분석 보고서</div>
    <h1>${esc(r.task_name)}</h1>
    <p class="rpt-summary">${esc(r.summary)}</p>
    <div class="rpt-meta"><span class="chip">📅 ${esc(date)}</span><span class="chip">🤖 ${esc(result.model)}</span>
      <span class="chip">⏱ ${esc(result.elapsed_sec)}초</span><span class="chip">💬 추가 답변 ${answers.length}건 반영</span></div>
    <div class="callout warn">⚠️ <span>${esc(DISCLAIMER)}</span></div>
    <div class="kpis">
      <div class="kpi accent"><b>${(r.problems || []).length}</b><span>주요 문제점</span></div>
      <div class="kpi"><b>${(r.candidates || []).length}</b><span>개선 후보</span></div>
      <div class="kpi"><b>${(r.questions || []).length}</b><span>추가 확인 질문</span></div>
      <div class="kpi"><b>${confirmed}<small style="font-size:.9rem;color:var(--muted)">/${allFacts.length}</small></b><span>원문으로 확인된 사실</span></div>
      <div class="kpi"><b>${(result.guardrail_log || []).length}</b><span>자동 검증 교정</span></div>
    </div></header>`;

  const nav = `<ol class="rpt-steps">${STEPS.map((s, i) => `<li><a href="#${s.id}" data-step="${i}"><span class="n">${i + 1}</span>${esc(s.short)}</a></li>`).join("")}</ol>`;
  const legend = `<div class="legend">${badge("확인")} 입력에 명시됨 ${badge("추정")} AI가 추론 ${badge("미확인")} 정보 없음</div>`;

  const s1 = slide(0, `<p>${esc(r.summary)}</p><h3>업무 목적</h3>${facts([r.task_purpose])}`);
  const s2 = slide(1, `${legend}<div class="flow">${(r.as_is_process || []).map((s) => `<div class="flow-step s-${esc(s.status)}"><strong>${esc(s.step)}</strong>${badge(s.status)}</div>`).join("")}</div>
    <h3>현재 업무 설명</h3><p>${esc(r.as_is_description)}</p>
    <h3>단계별 근거</h3>${facts((r.as_is_process || []).map((s) => ({ content: `${s.order}. ${s.step}`, status: s.status, evidence: s.evidence })))}`);
  const s3 = slide(2, `${legend}${facts(r.problems)}`);
  const s4 = slide(3, `<h3>개선 목적</h3>${facts(r.improvement_goals)}<h3>기대 효과</h3>${facts(r.expected_effects)}`);
  const s5 = slide(4, `<div class="compare"><div class="pane asis"><div class="label">AS-IS · 현재</div><p>${esc(r.as_is_description)}</p></div>
      <div class="pane tobe"><div class="label">TO-BE · 개선 후 (가안)</div><p>${esc(r.to_be_concept)}</p></div></div>
    <h3>개선 후보</h3><div class="cands">${(r.candidates || []).map((c, i) => `<article class="cand"><div class="cand-top"><span class="cand-no">후보 ${pad(i + 1)}</span><span class="tag ${tagClass(c.type)}">${esc(c.type)}</span></div>
      <h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><dl><dt>해결 대상 문제</dt><dd>${esc(c.related_problem)}</dd><dt>기대 효과</dt><dd>${esc(c.expected_effect)}</dd><dt>검토 전 전제 조건</dt><dd>${esc(c.prerequisite)}</dd></dl></article>`).join("")}</div>`);
  const s6 = slide(5, `${(r.questions || []).length ? `<div class="qs">${r.questions.map((q) => `<div class="q"><span class="cat">${esc(q.category)}</span><span class="text">${esc(q.question)}</span><span class="why">${esc(q.reason)}</span></div>`).join("")}</div>` : `<p class="empty">추가 질문이 없습니다.</p>`}
    ${answers.length ? `<h3>반영된 추가 답변</h3><ul class="answered">${answers.map((a) => `<li><b>Q.</b> ${esc(a.question)}<br><b>A.</b> ${esc(a.answer)}</li>`).join("")}</ul>` : ""}`);
  const log = result.guardrail_log || [];
  const s7 = slide(6, `<div class="basis">${esc(r.analysis_basis)}</div><h3>미확인 사항</h3>${(r.unconfirmed || []).length ? `<ul class="unk-list">${r.unconfirmed.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : `<p class="empty">없음</p>`}
    <h3>자동 검증(가드레일) 교정 내역</h3>${log.length ? `<table class="guard"><thead><tr><th>유형</th><th>위치</th><th>내용</th></tr></thead><tbody>${log.map((g) => `<tr><td>${esc(g.type)}</td><td>${esc(g.where)}</td><td>${esc(g.content)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">원문 근거가 없는 '확인' 항목이나 중복 질문이 발견되지 않았습니다.</p>`}`);

  const pager = `<div class="pager"><button type="button" class="prev">← 이전</button><span class="pos"></span><button type="button" class="next">다음 →</button></div>`;
  return `<div class="rpt">${cover}${nav}${s1}${s2}${s3}${s4}${s5}${s6}${s7}${pager}<p class="rpt-foot">AI Business Improvement Assistant · Main Quest 2 PoC</p></div>`;
}

// 단독 HTML 파일: CSS를 내장하고, 목차 강조(스크롤 위치)만 하는 짧은 스크립트를 넣는다.
export function standaloneHTML(markup, css, title) {
  const spy = `document.addEventListener("DOMContentLoaded",()=>{const a=[...document.querySelectorAll(".rpt-steps a")];const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){a.forEach(x=>x.classList.toggle("active",x.getAttribute("href")==="#"+e.target.id))}}),{rootMargin:"-40% 0px -55% 0px"});document.querySelectorAll(".slide").forEach(s=>o.observe(s))});`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@600&display=swap" rel="stylesheet">
<style>${css}</style></head><body class="rpt-standalone">${markup}<script>${spy}</script></body></html>`;
}
