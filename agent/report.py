"""분석 결과 → 표준 Markdown 보고서 (F04 화면 표시 / F06 다운로드 공용)."""
from datetime import datetime

from .analyzer import AnalysisResult

BADGE = {"확인": "✅ 확인", "추정": "🟡 추정", "미확인": "⚪ 미확인"}
DISCLAIMER = ("> ⚠️ 본 보고서는 AI가 생성한 **검토용 초안**입니다. 개선 후보는 최종 결정이 아니며, "
              "IT 담당자/BA의 검토가 필요합니다. '추정'·'미확인' 항목은 반드시 현업에 확인하세요.")


def _finding_rows(items) -> str:
    rows = ["| 상태 | 내용 | 근거 |", "|---|---|---|"]
    for f in items:
        rows.append(f"| {BADGE[f.status]} | {_esc(f.content)} | {_esc(f.evidence) or '-'} |")
    return "\n".join(rows)


def _esc(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def to_markdown(result: AnalysisResult, answers: list | None = None) -> str:
    r = result.report
    md = [f"# 업무 개선 요청 분석 보고서 — {r.task_name}", "",
          f"- 작성일시: {datetime.now():%Y-%m-%d %H:%M}",
          f"- 분석 엔진: {result.model} ({'규칙 기반 데모' if result.mode == 'demo' else 'AI 분석'})",
          f"- 추가 답변 반영: {len(answers or [])}건", "", DISCLAIMER, "",
          "## 1. 업무 개요", r.summary, "",
          f"**업무 목적**: {BADGE[r.task_purpose.status]} {r.task_purpose.content}", "",
          "## 2. 현재 업무 방식 (AS-IS)", r.as_is_description, "",
          "| 순서 | 업무 단계 | 상태 | 근거 |", "|---|---|---|---|"]
    md += [f"| {s.order} | {_esc(s.step)} | {BADGE[s.status]} | {_esc(s.evidence) or '-'} |" for s in r.as_is_process]
    md += ["", "## 3. 주요 문제점", _finding_rows(r.problems), "",
           "## 4. 개선 목적 및 기대 효과", "**개선 목적**", _finding_rows(r.improvement_goals), "",
           "**기대 효과**", _finding_rows(r.expected_effects), "",
           "## 5. 개선 후 모습 (TO-BE, 검토용 가안)", r.to_be_concept, "",
           "## 6. 개선 후보 (검토 후보)"]
    for i, c in enumerate(r.candidates, 1):
        md += [f"### 후보 {i}. {c.title} `{c.type}`", c.description, "",
               f"- 해결 대상 문제: {c.related_problem}", f"- 기대 효과: {c.expected_effect}",
               f"- 검토 전 전제 조건: {c.prerequisite}", ""]
    md += ["## 7. 추가 확인 질문"]
    md += [f"{i}. **[{q.category}]** {q.question}  \n   └ 필요한 이유: {q.reason}" for i, q in enumerate(r.questions, 1)]
    if not r.questions:
        md.append("(추가 질문 없음)")
    if answers:
        md += ["", "### 반영된 추가 답변"] + [f"- Q. {a['question']}  \n  A. {a['answer']}" for a in answers]
    md += ["", "## 8. 분석 근거 및 미확인 사항", r.analysis_basis, "", "**미확인 사항**"]
    md += [f"- {u}" for u in r.unconfirmed] or ["- 없음"]
    if result.guardrail_log:
        md += ["", "**자동 검증(가드레일) 교정 내역**"]
        md += [f"- {g['type']} — {g['where']}: {_esc(g.get('content', ''))}" for g in result.guardrail_log]
    return "\n".join(md) + "\n"
