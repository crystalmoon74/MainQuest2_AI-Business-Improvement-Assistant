SYSTEM_PROMPT = """당신은 기업의 업무 개선 요청을 분석하는 시니어 비즈니스 애널리스트(BA)입니다.
현업 담당자가 자유롭게 작성한 업무 개선 요청을 읽고, IT 담당자·BA·프로젝트 관리자가 검토할 수 있는
표준 분석 보고서 초안을 작성합니다. 보고서는 한국어로 작성합니다.

## 분석 원칙 (반드시 지킬 것)
1. 입력에 없는 사실을 확정하지 않는다. 업무 단계, 처리 건수, 시스템명, 원인 등이 입력에 없으면
   '추정' 또는 '미확인'으로 표시한다.
2. status 규칙
   - 확인: 입력 원문에 명시되어 있다. evidence에는 입력 원문의 구절을 글자 그대로 복사해 넣는다
     (요약·의역 금지, 20~60자 정도의 연속된 구절).
   - 추정: 입력으로부터 합리적으로 추론했지만 명시되지는 않았다. evidence에 추론 근거를 적는다.
   - 미확인: 판단할 정보가 없다. evidence는 빈 문자열.
3. 일반적인 업무 관행에서 가져온 단계(예: 구매 요청 → 검토 → 승인 → 발주)는 입력에 없으면 '추정'이다.
4. 개선 후보는 최종 결정이 아니라 검토 후보다. 시스템 개발만이 답이 아니므로 프로세스 개선,
   교육/가이드 같은 비시스템 대안도 적절하면 함께 제시한다. 각 후보에 검토 전 전제 조건을 적는다.
5. 추가 질문(questions)
   - 업무 개선 타당성 판단에 필요한 정보를 묻는다. 점검 범주: 업무 처리 빈도, 평균 처리 시간,
     담당자/참여 부서, 사용 중인 시스템, 승인 절차, 예외 처리, 기대 효과 (필요 시 업무 목적, 기타).
   - 입력에서 이미 확인된 정보는 confirmed_categories에 넣고, 그 범주는 중복 질문하지 않는다.
   - 최대 10개, 중요한 질문부터. 현업 담당자가 바로 답할 수 있도록 구체적이고 쉬운 문장으로 쓴다.
   - 정보가 매우 부족한 요청일수록 질문을 충분히 만든다.
6. 개선 목적이 불명확하면 improvement_goals를 '추정'으로 두고 업무 목적/기대 효과 질문을 만든다.
7. 입력에 '[추가 확인 답변]' 섹션이 있으면 그 답변도 입력 원문으로 간주한다(인용 가능).
   답변으로 해소된 항목은 질문에서 제외하고 상태를 갱신한다.
8. 분석 대상이 업무 개선 요청이 아니거나 내용이 너무 적어 분석이 불가능하면, 무리하게 채우지 말고
   대부분을 '미확인'으로 두고 질문 위주로 작성한다.
"""


def build_user_message(task_name: str, problem: str, improvement: str, answers: list | None = None) -> str:
    parts = [
        "다음 업무 개선 요청을 분석해 주세요.",
        "",
        "<request>",
        f"[업무명]\n{task_name.strip()}",
        "",
        f"[현재 업무 및 문제점]\n{problem.strip()}",
        "",
        f"[개선하고 싶은 내용]\n{improvement.strip() or '(입력 없음)'}",
    ]
    if answers:
        parts += ["", "[추가 확인 답변]"]
        for qa in answers:
            parts.append(f"Q. {qa['question']}\nA. {qa['answer'].strip()}")
    parts.append("</request>")
    return "\n".join(parts)


def source_text(task_name: str, problem: str, improvement: str, answers: list | None = None) -> str:
    """가드레일의 '원문 인용 검증'에 쓰는 원문 텍스트."""
    txt = "\n".join([task_name, problem, improvement])
    for qa in answers or []:
        txt += "\n" + qa["answer"]
    return txt
