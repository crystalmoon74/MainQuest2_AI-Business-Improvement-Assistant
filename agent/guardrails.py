"""Agent 검증 단계: Claude 출력의 '사실 확정 오류'를 코드로 검사하고 교정한다.

- status='확인'인데 evidence가 입력 원문에 없으면 → '추정'으로 강등하고 로그에 기록
- 질문 중복 제거, 이미 확인된 범주의 질문 제거, 최대 10개 제한
"""
import re
from difflib import SequenceMatcher

from .schema import AnalysisReport

MAX_QUESTIONS = 10


def _norm(s: str) -> str:
    return re.sub(r"[\s\"'“”‘’.,·…()\[\]~!?:;\-]", "", s or "").lower()


def evidence_in_source(evidence: str, source: str) -> bool:
    ev, src = _norm(evidence), _norm(source)
    if not ev:
        return False
    if ev in src:
        return True
    # 인용 중 말줄임(...)으로 이어붙인 경우: 조각 모두가 원문에 있으면 인정
    pieces = [_norm(p) for p in re.split(r"…|\.\.\.|/", evidence) if len(_norm(p)) >= 4]
    return bool(pieces) and all(p in src for p in pieces)


def apply_guardrails(report: AnalysisReport, source: str) -> tuple[AnalysisReport, list[dict]]:
    log: list[dict] = []

    def check(item, where: str):
        if item.status == "확인" and not evidence_in_source(item.evidence, source):
            log.append({"type": "근거 불일치 → 추정으로 강등", "where": where,
                        "content": getattr(item, "content", None) or getattr(item, "step", ""),
                        "evidence": item.evidence})
            item.status = "추정"
            item.evidence = f"(원문에서 인용 확인 불가) {item.evidence}".strip()

    check(report.task_purpose, "업무 목적")
    for s in report.as_is_process:
        check(s, f"현재 업무 절차 {s.order}")
    for name, items in [("주요 문제점", report.problems), ("개선 목적", report.improvement_goals),
                        ("기대 효과", report.expected_effects)]:
        for i, f in enumerate(items, 1):
            check(f, f"{name} {i}")

    # 질문 정리
    confirmed = set(report.confirmed_categories)
    kept = []
    for q in report.questions:
        if q.category in confirmed and q.category != "기타":
            log.append({"type": "이미 확인된 범주 질문 제거", "where": q.category, "content": q.question})
            continue
        if any(SequenceMatcher(None, _norm(q.question), _norm(k.question)).ratio() > 0.8 for k in kept):
            log.append({"type": "중복 질문 제거", "where": q.category, "content": q.question})
            continue
        kept.append(q)
    if len(kept) > MAX_QUESTIONS:
        for q in kept[MAX_QUESTIONS:]:
            log.append({"type": "질문 10개 초과분 제거", "where": q.category, "content": q.question})
        kept = kept[:MAX_QUESTIONS]
    report.questions = kept
    return report, log
