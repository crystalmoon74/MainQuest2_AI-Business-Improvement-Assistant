"""업무 개선 요청 분석 Agent (단일 Agent).

절차: ① 입력 검증 → ② LLM 구조화 분석(요구사항 구조화 + 누락 정보/질문 생성)
      → ③ 가드레일 검증(사실 확정 오류 교정) → ④ 보고서 생성
F05: 추가 답변이 들어오면 원 요청 + 답변으로 ②~④를 다시 수행해 보고서를 갱신한다.

분석 엔진(mode)
- gemini : Google ADK + Gemini (무료 티어, 기본값)   — agent/adk_agent.py
- claude : Anthropic Claude API (유료, 선택)          — 아래 _call_claude
- demo   : 규칙 기반 기준선 (AI 미사용)               — agent/baseline.py
"""
import os
import time
from dataclasses import dataclass, field

from .adk_agent import GEMINI_MODEL, call_gemini_adk, gemini_key_available
from .errors import AnalysisError
from .guardrails import apply_guardrails
from .prompts import SYSTEM_PROMPT, build_user_message, source_text
from .schema import AnalysisReport

CLAUDE_MODEL = os.getenv("ANALYZER_MODEL", "claude-opus-5-5")
CLAUDE_EFFORT = os.getenv("ANALYZER_EFFORT", "medium")

ENGINE_LABELS = {
    "gemini": "Gemini (Google ADK, 무료)",
    "claude": "Claude API (유료)",
    "demo": "규칙 기반 데모 (AI 미사용)",
}


@dataclass
class AnalysisResult:
    report: AnalysisReport
    guardrail_log: list = field(default_factory=list)
    elapsed_sec: float = 0.0
    mode: str = "gemini"
    model: str = GEMINI_MODEL
    usage: dict = field(default_factory=dict)


def validate_input(task_name: str, problem: str) -> list[str]:
    errors = []
    if not task_name or not task_name.strip():
        errors.append("업무명을 입력해 주세요.")
    if not problem or not problem.strip():
        errors.append("현재 업무 및 문제점 설명을 입력해 주세요.")
    elif len(problem.strip()) < 10:
        errors.append("문제점 설명이 너무 짧습니다. 한두 문장 이상 적어 주세요.")
    if len((problem or "") + (task_name or "")) > 8000:
        errors.append("입력이 너무 깁니다(8,000자 이하). 핵심 내용 위주로 줄여 주세요.")
    return errors


def available_engines() -> list[str]:
    engines = []
    if gemini_key_available():
        engines.append("gemini")
    if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"):
        engines.append("claude")
    return engines + ["demo"]


def has_api_key() -> bool:
    return available_engines() != ["demo"]


def analyze(task_name: str, problem: str, improvement: str = "", answers: list | None = None,
            mode: str = "gemini") -> AnalysisResult:
    errors = validate_input(task_name, problem)
    if errors:
        raise AnalysisError(" ".join(errors), retryable=False)

    start = time.perf_counter()
    msg = build_user_message(task_name, problem, improvement, answers)
    if mode == "demo":
        from .baseline import rule_based_analyze
        report, usage, model = rule_based_analyze(task_name, problem, improvement, answers), {}, "rule-based"
    elif mode == "claude":
        (report, usage), model = _call_claude(msg), CLAUDE_MODEL
    else:
        if not gemini_key_available():
            raise AnalysisError("GOOGLE_API_KEY 환경변수가 없습니다. Google AI Studio에서 무료 키를 발급해 설정해 주세요.",
                                retryable=False)
        (report, usage), model = _with_retry(lambda: call_gemini_adk(msg)), GEMINI_MODEL

    report, log = apply_guardrails(report, source_text(task_name, problem, improvement, answers))
    return AnalysisResult(report=report, guardrail_log=log, elapsed_sec=round(time.perf_counter() - start, 1),
                          mode=mode, model=model, usage=usage)


def _with_retry(fn, waits=(5, 15)):
    """무료 티어에서 잦은 일시 오류(503 과부하, 429 분당 한도)는 잠시 기다렸다가 자동 재시도."""
    for wait in (*waits, None):
        try:
            return fn()
        except AnalysisError as e:
            if not e.retryable or wait is None:
                raise
            time.sleep(wait)


def _call_claude(user_message: str) -> tuple[AnalysisReport, dict]:
    import anthropic

    client = anthropic.Anthropic(max_retries=2, timeout=180)
    try:
        response = client.beta.messages.parse(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            output_format=AnalysisReport,
            output_config={"effort": CLAUDE_EFFORT},
            # 안전 분류기 거절 시 서버가 자동으로 대체 모델로 재시도
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise AnalysisError("API 키가 올바르지 않습니다. ANTHROPIC_API_KEY 환경변수를 확인해 주세요.", retryable=False)
    except anthropic.RateLimitError:
        raise AnalysisError("요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.")
    except anthropic.BadRequestError as e:
        raise AnalysisError(f"요청 형식 오류로 분석하지 못했습니다: {e.message}", retryable=False)
    except anthropic.APIStatusError as e:
        raise AnalysisError(f"AI 서비스 오류(HTTP {e.status_code})가 발생했습니다. 다시 시도해 주세요.")
    except anthropic.APIConnectionError:
        raise AnalysisError("AI 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.")

    if response.stop_reason == "refusal":
        raise AnalysisError("AI가 이 요청의 분석을 거절했습니다. 내용을 수정해 다시 시도해 주세요.", retryable=False)
    if response.stop_reason == "max_tokens":
        raise AnalysisError("분석 결과가 너무 길어 중간에 끊겼습니다. 입력을 줄여 다시 시도해 주세요.")
    if response.parsed_output is None:
        raise AnalysisError("AI 응답을 보고서 형식으로 해석하지 못했습니다. 다시 시도해 주세요.")

    u = response.usage
    return response.parsed_output, {"input_tokens": u.input_tokens, "output_tokens": u.output_tokens}
