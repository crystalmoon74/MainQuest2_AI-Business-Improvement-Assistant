// 자동 생성 파일 — scripts/export_web_config.py 로 다시 만드세요 (원본: agent/prompts.py, agent/schema.py)
export const SYSTEM_PROMPT = "당신은 기업의 업무 개선 요청을 분석하는 시니어 비즈니스 애널리스트(BA)입니다.\n현업 담당자가 자유롭게 작성한 업무 개선 요청을 읽고, IT 담당자·BA·프로젝트 관리자가 검토할 수 있는\n표준 분석 보고서 초안을 작성합니다. 보고서는 한국어로 작성합니다.\n\n## 분석 원칙 (반드시 지킬 것)\n1. 입력에 없는 사실을 확정하지 않는다. 업무 단계, 처리 건수, 시스템명, 원인 등이 입력에 없으면\n   '추정' 또는 '미확인'으로 표시한다.\n2. status 규칙\n   - 확인: 입력 원문에 명시되어 있다. evidence에는 입력 원문의 구절을 글자 그대로 복사해 넣는다\n     (요약·의역 금지, 20~60자 정도의 연속된 구절).\n   - 추정: 입력으로부터 합리적으로 추론했지만 명시되지는 않았다. evidence에 추론 근거를 적는다.\n   - 미확인: 판단할 정보가 없다. evidence는 빈 문자열.\n3. 일반적인 업무 관행에서 가져온 단계(예: 구매 요청 → 검토 → 승인 → 발주)는 입력에 없으면 '추정'이다.\n4. 개선 후보는 최종 결정이 아니라 검토 후보다. 시스템 개발만이 답이 아니므로 프로세스 개선,\n   교육/가이드 같은 비시스템 대안도 적절하면 함께 제시한다. 각 후보에 검토 전 전제 조건을 적는다.\n5. 추가 질문(questions)\n   - 업무 개선 타당성 판단에 필요한 정보를 묻는다. 점검 범주: 업무 처리 빈도, 평균 처리 시간,\n     담당자/참여 부서, 사용 중인 시스템, 승인 절차, 예외 처리, 기대 효과 (필요 시 업무 목적, 기타).\n   - 입력에서 이미 확인된 정보는 confirmed_categories에 넣고, 그 범주는 중복 질문하지 않는다.\n   - 최대 10개, 중요한 질문부터. 현업 담당자가 바로 답할 수 있도록 구체적이고 쉬운 문장으로 쓴다.\n   - 정보가 매우 부족한 요청일수록 질문을 충분히 만든다.\n6. 개선 목적이 불명확하면 improvement_goals를 '추정'으로 두고 업무 목적/기대 효과 질문을 만든다.\n7. 입력에 '[추가 확인 답변]' 섹션이 있으면 그 답변도 입력 원문으로 간주한다(인용 가능).\n   답변으로 해소된 항목은 질문에서 제외하고 상태를 갱신한다.\n8. 분석 대상이 업무 개선 요청이 아니거나 내용이 너무 적어 분석이 불가능하면, 무리하게 채우지 말고\n   대부분을 '미확인'으로 두고 질문 위주로 작성한다.\n";
export const REPORT_SCHEMA = {
 "properties": {
  "task_name": {
   "type": "string"
  },
  "summary": {
   "description": "요청 요약 (2~3문장)",
   "type": "string"
  },
  "task_purpose": {
   "properties": {
    "content": {
     "description": "분석 내용 (한 문장)",
     "type": "string"
    },
    "status": {
     "description": "확인=입력에 명시됨, 추정=AI의 추론, 미확인=정보 없음",
     "enum": [
      "확인",
      "추정",
      "미확인"
     ],
     "type": "string"
    },
    "evidence": {
     "description": "status가 '확인'이면 입력 원문을 그대로 인용한 구절. '추정'이면 추론 근거. '미확인'이면 빈 문자열",
     "type": "string"
    }
   },
   "required": [
    "content",
    "status",
    "evidence"
   ],
   "type": "object"
  },
  "as_is_description": {
   "description": "현재 업무 방식 서술",
   "type": "string"
  },
  "as_is_process": {
   "items": {
    "properties": {
     "order": {
      "type": "integer"
     },
     "step": {
      "description": "업무 단계 이름",
      "type": "string"
     },
     "status": {
      "enum": [
       "확인",
       "추정",
       "미확인"
      ],
      "type": "string"
     },
     "evidence": {
      "type": "string"
     }
    },
    "required": [
     "order",
     "step",
     "status",
     "evidence"
    ],
    "type": "object"
   },
   "type": "array"
  },
  "problems": {
   "items": {
    "properties": {
     "content": {
      "description": "분석 내용 (한 문장)",
      "type": "string"
     },
     "status": {
      "description": "확인=입력에 명시됨, 추정=AI의 추론, 미확인=정보 없음",
      "enum": [
       "확인",
       "추정",
       "미확인"
      ],
      "type": "string"
     },
     "evidence": {
      "description": "status가 '확인'이면 입력 원문을 그대로 인용한 구절. '추정'이면 추론 근거. '미확인'이면 빈 문자열",
      "type": "string"
     }
    },
    "required": [
     "content",
     "status",
     "evidence"
    ],
    "type": "object"
   },
   "type": "array"
  },
  "improvement_goals": {
   "items": {
    "properties": {
     "content": {
      "description": "분석 내용 (한 문장)",
      "type": "string"
     },
     "status": {
      "description": "확인=입력에 명시됨, 추정=AI의 추론, 미확인=정보 없음",
      "enum": [
       "확인",
       "추정",
       "미확인"
      ],
      "type": "string"
     },
     "evidence": {
      "description": "status가 '확인'이면 입력 원문을 그대로 인용한 구절. '추정'이면 추론 근거. '미확인'이면 빈 문자열",
      "type": "string"
     }
    },
    "required": [
     "content",
     "status",
     "evidence"
    ],
    "type": "object"
   },
   "type": "array"
  },
  "expected_effects": {
   "items": {
    "properties": {
     "content": {
      "description": "분석 내용 (한 문장)",
      "type": "string"
     },
     "status": {
      "description": "확인=입력에 명시됨, 추정=AI의 추론, 미확인=정보 없음",
      "enum": [
       "확인",
       "추정",
       "미확인"
      ],
      "type": "string"
     },
     "evidence": {
      "description": "status가 '확인'이면 입력 원문을 그대로 인용한 구절. '추정'이면 추론 근거. '미확인'이면 빈 문자열",
      "type": "string"
     }
    },
    "required": [
     "content",
     "status",
     "evidence"
    ],
    "type": "object"
   },
   "type": "array"
  },
  "to_be_concept": {
   "description": "개선 후(To-Be) 모습 초안. 확정이 아닌 검토용 가안임을 전제로 서술",
   "type": "string"
  },
  "candidates": {
   "items": {
    "properties": {
     "title": {
      "type": "string"
     },
     "type": {
      "enum": [
       "프로세스 개선",
       "시스템/자동화",
       "AI 활용",
       "교육/가이드",
       "기타"
      ],
      "type": "string"
     },
     "description": {
      "type": "string"
     },
     "related_problem": {
      "description": "이 후보가 해결하려는 주요 문제점",
      "type": "string"
     },
     "expected_effect": {
      "type": "string"
     },
     "prerequisite": {
      "description": "검토 전에 확인해야 할 전제 조건",
      "type": "string"
     }
    },
    "required": [
     "title",
     "type",
     "description",
     "related_problem",
     "expected_effect",
     "prerequisite"
    ],
    "type": "object"
   },
   "type": "array"
  },
  "confirmed_categories": {
   "description": "입력에서 이미 확인된 정보 범주 (중복 질문 방지용)",
   "items": {
    "enum": [
     "업무 처리 빈도",
     "평균 처리 시간",
     "담당자/참여 부서",
     "사용 중인 시스템",
     "승인 절차",
     "예외 처리",
     "기대 효과",
     "업무 목적",
     "기타"
    ],
    "type": "string"
   },
   "type": "array"
  },
  "questions": {
   "description": "추가 확인 질문, 최대 10개, 중요도 순",
   "items": {
    "properties": {
     "category": {
      "enum": [
       "업무 처리 빈도",
       "평균 처리 시간",
       "담당자/참여 부서",
       "사용 중인 시스템",
       "승인 절차",
       "예외 처리",
       "기대 효과",
       "업무 목적",
       "기타"
      ],
      "type": "string"
     },
     "question": {
      "type": "string"
     },
     "reason": {
      "description": "이 정보가 왜 필요한지",
      "type": "string"
     }
    },
    "required": [
     "category",
     "question",
     "reason"
    ],
    "type": "object"
   },
   "type": "array"
  },
  "unconfirmed": {
   "description": "분석에 필요하지만 확인되지 않은 사항 목록",
   "items": {
    "type": "string"
   },
   "type": "array"
  },
  "analysis_basis": {
   "description": "분석 근거 및 한계 설명",
   "type": "string"
  }
 },
 "required": [
  "task_name",
  "summary",
  "task_purpose",
  "as_is_description",
  "as_is_process",
  "problems",
  "improvement_goals",
  "expected_effects",
  "to_be_concept",
  "candidates",
  "confirmed_categories",
  "questions",
  "unconfirmed",
  "analysis_basis"
 ],
 "type": "object"
};
