"""분석 결과 → 슬라이드형 HTML 보고서 (Streamlit 화면 표시 / HTML 다운로드).

웹 버전(web/report.js)과 같은 마크업 구조·클래스명을 쓰고, 스타일은 web/report.css 를 그대로 내장한다.
"""
from datetime import datetime
from html import escape
from pathlib import Path

from .analyzer import AnalysisResult

CSS_PATH = Path(__file__).resolve().parent.parent / "web" / "report.css"

STEPS = [
    ("s1", "요청 요약", "업무 개요", "요청 내용을 요약하고 업무 목적을 정리했습니다."),
    ("s2", "현재 업무", "현재 업무 방식 (AS-IS)", "입력에서 확인되거나 추정되는 업무 절차입니다. 점선 단계는 추정·미확인입니다."),
    ("s3", "문제점", "주요 문제점", "현재 업무에서 드러난 문제를 근거와 함께 정리했습니다."),
    ("s4", "목적·효과", "개선 목적 및 기대 효과", "무엇을 위해 개선하고, 개선되면 무엇이 좋아지는지입니다."),
    ("s5", "개선 방향", "개선 방향 (TO-BE)과 개선 후보", "개선 후 모습의 가안과 검토할 후보입니다. 최종 결정이 아닌 검토용입니다."),
    ("s6", "추가 질문", "추가 확인 질문", "타당성 판단에 필요한 정보입니다. 답변하면 보고서가 갱신됩니다."),
    ("s7", "근거·검증", "분석 근거 및 미확인 사항", "분석의 근거와 한계, 자동 검증으로 바로잡은 내역입니다."),
]
DISCLAIMER = ("AI가 생성한 검토용 초안입니다. 개선 후보는 최종 결정이 아니며 IT 담당자·BA의 검토가 필요합니다. "
              "'추정'·'미확인' 항목은 반드시 현업에 확인하세요.")
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@600&display=swap" rel="stylesheet">')
SPY = ('document.addEventListener("DOMContentLoaded",()=>{const a=[...document.querySelectorAll(".rpt-steps a")];'
       'const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){a.forEach(x=>x.classList.toggle("active",'
       'x.getAttribute("href")==="#"+e.target.id))}}),{rootMargin:"-40% 0px -55% 0px"});'
       'document.querySelectorAll(".slide").forEach(s=>o.observe(s))});')


def e(s) -> str:
    return escape("" if s is None else str(s))


def badge(st: str) -> str:
    return f'<span class="badge s-{e(st)}">{e(st)}</span>'


def _facts(items) -> str:
    if not items:
        return '<p class="empty">해당 내용 없음</p>'
    out = []
    for f in items:
        ev = ""
        if f["evidence"]:
            src = f'문서 「{e(f["source_doc"])}」 ' if f.get("source_doc") else "원문 "
            ev = (f'<div class="ev">{src}<q>{e(f["evidence"])}</q></div>' if f["status"] == "확인"
                  else f'<div class="ev">근거: {e(f["evidence"])}</div>')
        out.append(f'<div class="fact s-{e(f["status"])}">{badge(f["status"])}<div class="content">{e(f["content"])}</div>{ev}</div>')
    return f'<div class="facts">{"".join(out)}</div>'


def _slide(i: int, body: str) -> str:
    sid, short, title, lead = STEPS[i]
    return (f'<section class="slide" id="{sid}" data-step="{i}"><header class="slide-head"><div class="slide-num">{i + 1:02d}</div>'
            f'<div class="slide-kicker">STEP {i + 1} · {e(short)}</div><h2>{e(title)}</h2><p class="slide-lead">{e(lead)}</p></header>{body}</section>')


def build_report(result: AnalysisResult, answers: list | None = None) -> str:
    answers = answers or []
    r = result.report.model_dump()
    all_facts = [r["task_purpose"], *r["as_is_process"], *r["problems"], *r["improvement_goals"], *r["expected_effects"]]
    confirmed = sum(f["status"] == "확인" for f in all_facts)
    engine = result.model if result.mode != "demo" else "규칙 기반 데모 (AI 미사용)"
    legend = f'<div class="legend">{badge("확인")} 입력에 명시됨 {badge("추정")} AI가 추론 {badge("미확인")} 정보 없음</div>'

    cover = (f'<header class="rpt-cover"><div class="rpt-eyebrow">업무 개선 요청 분석 보고서</div><h1>{e(r["task_name"])}</h1>'
             f'<p class="rpt-summary">{e(r["summary"])}</p><div class="rpt-meta"><span class="chip">📅 {datetime.now():%Y-%m-%d %H:%M}</span>'
             f'<span class="chip">🤖 {e(engine)}</span><span class="chip">⏱ {e(result.elapsed_sec)}초</span>'
             + (f'<span class="chip">📄 참고 문서 {len(result.documents)}건</span>' if result.documents else "")
             + f'<span class="chip">💬 추가 답변 {len(answers)}건 반영</span></div><div class="callout warn">⚠️ <span>{e(DISCLAIMER)}</span></div>'
             f'<div class="kpis"><div class="kpi accent"><b>{len(r["problems"])}</b><span>주요 문제점</span></div>'
             f'<div class="kpi"><b>{len(r["candidates"])}</b><span>개선 후보</span></div>'
             f'<div class="kpi"><b>{len(r["questions"])}</b><span>추가 확인 질문</span></div>'
             f'<div class="kpi"><b>{confirmed}<small style="font-size:.9rem;color:var(--muted)">/{len(all_facts)}</small></b><span>원문으로 확인된 사실</span></div>'
             f'<div class="kpi"><b>{len(result.guardrail_log)}</b><span>자동 검증 교정</span></div></div></header>')
    nav = '<ol class="rpt-steps">' + "".join(
        f'<li><a href="#{sid}" data-step="{i}"><span class="n">{i + 1}</span>{e(short)}</a></li>' for i, (sid, short, _, _) in enumerate(STEPS)) + "</ol>"

    flow = "".join(f'<div class="flow-step s-{e(s["status"])}"><strong>{e(s["step"])}</strong>{badge(s["status"])}</div>' for s in r["as_is_process"])
    steps_facts = [{"content": f'{s["order"]}. {s["step"]}', "status": s["status"], "evidence": s["evidence"],
                    "source_doc": s.get("source_doc", "")} for s in r["as_is_process"]]
    refs = r.get("reference_findings") or []
    ref_html = ""
    if result.documents or refs:
        docs = "".join(f'<span class="chip">📄 {e(d["kind"])} · {e(d["name"])}</span>' for d in result.documents)
        groups = ""
        for t in ["요청과 차이", "규정 근거", "개선 제약", "문서 미비"]:
            items = [x for x in refs if x["type"] == t]
            if items:
                groups += f"<h3>{e(t)}</h3>" + _facts([{"content": x["content"], "status": "확인" if x["evidence"] else "미확인",
                                                       "evidence": x["evidence"], "source_doc": x["doc"]} for x in items])
        ref_html = (f'<h3>참고 문서 검토</h3><div class="rpt-meta">{docs}</div>'
                    + (groups or '<p class="empty">참고 문서에서 요청과 관련된 특이 사항을 찾지 못했습니다.</p>'))
    cands = "".join(
        f'<article class="cand"><div class="cand-top"><span class="cand-no">후보 {i:02d}</span>'
        f'<span class="tag t-{e(c["type"].replace(" ", "").replace("/", ""))}">{e(c["type"])}</span></div><h3>{e(c["title"])}</h3>'
        f'<p>{e(c["description"])}</p><dl><dt>해결 대상 문제</dt><dd>{e(c["related_problem"])}</dd><dt>기대 효과</dt>'
        f'<dd>{e(c["expected_effect"])}</dd><dt>검토 전 전제 조건</dt><dd>{e(c["prerequisite"])}</dd></dl></article>'
        for i, c in enumerate(r["candidates"], 1))
    qs = ('<div class="qs">' + "".join(
        f'<div class="q"><span class="cat">{e(q["category"])}</span><span class="text">{e(q["question"])}</span><span class="why">{e(q["reason"])}</span></div>'
        for q in r["questions"]) + "</div>") if r["questions"] else '<p class="empty">추가 질문이 없습니다.</p>'
    if answers:
        qs += '<h3>반영된 추가 답변</h3><ul class="answered">' + "".join(
            f'<li><b>Q.</b> {e(a["question"])}<br><b>A.</b> {e(a["answer"])}</li>' for a in answers) + "</ul>"
    unk = ('<ul class="unk-list">' + "".join(f"<li>{e(u)}</li>" for u in r["unconfirmed"]) + "</ul>") if r["unconfirmed"] else '<p class="empty">없음</p>'
    log = result.guardrail_log
    guard = ('<table class="guard"><thead><tr><th>유형</th><th>위치</th><th>내용</th></tr></thead><tbody>' + "".join(
        f'<tr><td>{e(g["type"])}</td><td>{e(g["where"])}</td><td>{e(g.get("content", ""))}</td></tr>' for g in log) + "</tbody></table>") if log \
        else "<p class=\"empty\">원문 근거가 없는 '확인' 항목이나 중복 질문이 발견되지 않았습니다.</p>"

    slides = [
        _slide(0, f'<p>{e(r["summary"])}</p><h3>업무 목적</h3>{_facts([r["task_purpose"]])}'),
        _slide(1, f'{legend}<div class="flow">{flow}</div><h3>현재 업무 설명</h3><p>{e(r["as_is_description"])}</p><h3>단계별 근거</h3>{_facts(steps_facts)}'),
        _slide(2, f'{legend}{_facts(r["problems"])}{ref_html}'),
        _slide(3, f'<h3>개선 목적</h3>{_facts(r["improvement_goals"])}<h3>기대 효과</h3>{_facts(r["expected_effects"])}'),
        _slide(4, f'<div class="compare"><div class="pane asis"><div class="label">AS-IS · 현재</div><p>{e(r["as_is_description"])}</p></div>'
                  f'<div class="pane tobe"><div class="label">TO-BE · 개선 후 (가안)</div><p>{e(r["to_be_concept"])}</p></div></div>'
                  f'<h3>개선 후보</h3><div class="cands">{cands}</div>'),
        _slide(5, qs),
        _slide(6, f'<div class="basis">{e(r["analysis_basis"])}</div><h3>미확인 사항</h3>{unk}<h3>자동 검증(가드레일) 교정 내역</h3>{guard}'),
    ]
    return (f'<div class="rpt">{cover}{nav}{"".join(slides)}'
            '<p class="rpt-foot">AI Business Improvement Assistant · Main Quest 2 PoC</p></div>')


def to_html(result: AnalysisResult, answers: list | None = None) -> str:
    """CSS를 내장한 단독 HTML 파일."""
    css = CSS_PATH.read_text(encoding="utf-8")
    title = f"분석 보고서 — {result.report.task_name}"
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{e(title)}</title>{FONTS}<style>{css}</style></head><body class="rpt-standalone">'
            f'{build_report(result, answers)}<script>{SPY}</script></body></html>')
