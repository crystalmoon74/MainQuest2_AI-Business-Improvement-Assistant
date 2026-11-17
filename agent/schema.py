"""분석 보고서 데이터 구조 (Claude 구조화 출력 스키마).

PRD F02/F03/F04의 분석 항목을 그대로 필드로 옮겼다.
모든 '사실' 항목은 status(확인/추정/미확인)와 evidence(근거)를 함께 가진다.
"""
from typing import List, Literal

from pydantic import BaseModel, Field

Status = Literal["확인", "추정", "미확인"]

QuestionCategory = Literal[
    "업무 처리 빈도",
    "평균 처리 시간",
    "담당자/참여 부서",
    "사용 중인 시스템",
    "승인 절차",
    "예외 처리",
    "기대 효과",
    "업무 목적",
    "기타",
]

CandidateType = Literal["프로세스 개선", "시스템/자동화", "AI 활용", "교육/가이드", "기타"]


class Finding(BaseModel):
    content: str = Field(description="분석 내용 (한 문장)")
    status: Status = Field(description="확인=입력에 명시됨, 추정=AI의 추론, 미확인=정보 없음")
    evidence: str = Field(
        description="status가 '확인'이면 입력 원문을 그대로 인용한 구절. '추정'이면 추론 근거. '미확인'이면 빈 문자열"
    )


class ProcessStep(BaseModel):
    order: int
    step: str = Field(description="업무 단계 이름")
    status: Status
    evidence: str


class Candidate(BaseModel):
    title: str
    type: CandidateType
    description: str
    related_problem: str = Field(description="이 후보가 해결하려는 주요 문제점")
    expected_effect: str
    prerequisite: str = Field(description="검토 전에 확인해야 할 전제 조건")


class Question(BaseModel):
    category: QuestionCategory
    question: str
    reason: str = Field(description="이 정보가 왜 필요한지")


class AnalysisReport(BaseModel):
    task_name: str
    summary: str = Field(description="요청 요약 (2~3문장)")
    task_purpose: Finding
    as_is_description: str = Field(description="현재 업무 방식 서술")
    as_is_process: List[ProcessStep]
    problems: List[Finding]
    improvement_goals: List[Finding]
    expected_effects: List[Finding]
    to_be_concept: str = Field(description="개선 후(To-Be) 모습 초안. 확정이 아닌 검토용 가안임을 전제로 서술")
    candidates: List[Candidate]
    confirmed_categories: List[QuestionCategory] = Field(
        description="입력에서 이미 확인된 정보 범주 (중복 질문 방지용)"
    )
    questions: List[Question] = Field(description="추가 확인 질문, 최대 10개, 중요도 순")
    unconfirmed: List[str] = Field(description="분석에 필요하지만 확인되지 않은 사항 목록")
    analysis_basis: str = Field(description="분석 근거 및 한계 설명")
