"""규칙 기반(키워드) 분석기 — AI 미사용 비교 기준선 + API 키 없이 화면을 시연하는 데모 모드.

AI 모델 선정 근거에서 'LLM 없이 규칙만으로는 어디까지 되는가'를 비교하기 위해 만든 것으로,
문장 분리와 키워드 매칭만 한다. 업무 절차 추론이나 맥락 이해는 하지 못한다.
"""
import re

from .schema import AnalysisReport, Candidate, Finding, ProcessStep, Question

PROBLEM_KW = ["어렵", "복잡", "번거", "수작업", "수기", "반복", "오래", "누락", "오류", "지연", "불편",
              "비효율", "확인하기", "힘들", "많이 걸", "실수", "중복", "느리"]
GOAL_KW = ["자동화", "개선", "줄이", "효율", "싶", "하고자", "원합니다", "필요"]

CATEGORY_KW = {
    "업무 처리 빈도": ["매일", "매주", "매월", "월 ", "주 ", "건", "회", "빈도"],
    "평균 처리 시간": ["시간", "분", "일 걸", "소요"],
    "담당자/참여 부서": ["팀", "부서", "담당자", "명이", "명의"],
    "사용 중인 시스템": ["엑셀", "excel", "erp", "시스템", "이메일", "메일", "그룹웨어", "솔루션", "메신저"],
    "승인 절차": ["승인", "결재"],
    "예외 처리": ["예외", "반려", "긴급"],
    "기대 효과": ["효과", "절감", "단축", "줄이"],
}
QUESTION_TEMPLATES = {
    "업무 처리 빈도": "이 업무는 한 달에 대략 몇 건(또는 몇 번) 처리하나요?",
    "평균 처리 시간": "한 건을 처리하는 데 평균 얼마나 걸리나요?",
    "담당자/참여 부서": "이 업무에 참여하는 담당자와 부서는 어디인가요?",
    "사용 중인 시스템": "현재 이 업무에 사용하는 시스템이나 도구는 무엇인가요?",
    "승인 절차": "승인(결재) 단계는 몇 단계이며 누가 승인하나요?",
    "예외 처리": "정상 흐름에서 벗어나는 예외 상황(반려, 긴급 건 등)은 어떻게 처리하나요?",
    "기대 효과": "개선되면 어떤 효과(시간 절감, 오류 감소 등)를 기대하나요?",
}


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?다요])\s+|\n+", text or "") if len(s.strip()) > 3]


def rule_based_analyze(task_name, problem, improvement, answers=None) -> AnalysisReport:
    full = "\n".join([problem, improvement] + [a["answer"] for a in (answers or [])])
    sents = _sentences(full)
    problems = [Finding(content=s, status="확인", evidence=s) for s in sents if any(k in s for k in PROBLEM_KW)]
    goals = [Finding(content=s, status="확인", evidence=s) for s in _sentences(improvement) or sents
             if any(k in s for k in GOAL_KW)]
    low = full.lower()
    confirmed = [c for c, kws in CATEGORY_KW.items() if any(k in low for k in kws)]
    questions = [Question(category=c, question=q, reason="규칙 기반: 입력에서 해당 키워드를 찾지 못함")
                 for c, q in QUESTION_TEMPLATES.items() if c not in confirmed]
    return AnalysisReport(
        task_name=task_name,
        summary=(sents[0] if sents else problem)[:200],
        task_purpose=Finding(content="(규칙 기반 분석으로는 업무 목적을 추론할 수 없음)", status="미확인", evidence=""),
        as_is_description=problem.strip(),
        as_is_process=[ProcessStep(order=1, step="(절차 추론 불가 — 원문 참고)", status="미확인", evidence="")],
        problems=problems or [Finding(content="문제점 키워드를 찾지 못함", status="미확인", evidence="")],
        improvement_goals=goals or [Finding(content="개선 목적 키워드를 찾지 못함", status="미확인", evidence="")],
        expected_effects=[Finding(content="기대 효과 미기재", status="미확인", evidence="")],
        to_be_concept="(규칙 기반 분석은 To-Be를 제안하지 않음)",
        candidates=[Candidate(title="업무 담당자 인터뷰 후 재분석", type="기타",
                              description="키워드 매칭만으로는 개선 후보를 도출할 수 없음",
                              related_problem="전체", expected_effect="-", prerequisite="-")],
        confirmed_categories=confirmed,
        questions=questions,
        unconfirmed=[f"{c} 정보" for c in QUESTION_TEMPLATES if c not in confirmed],
        analysis_basis="데모/기준선 모드: AI를 사용하지 않고 문장 분리와 키워드 매칭으로 생성한 결과입니다.",
    )
