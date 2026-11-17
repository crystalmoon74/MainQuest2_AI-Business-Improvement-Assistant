"""Google ADK 기반 분석 Agent (Gemini 무료 티어 사용).

ADK LlmAgent에 분석 원칙(instruction)과 보고서 스키마(output_schema)를 주고,
InMemoryRunner로 1회 실행해 세션 state에 저장된 구조화 결과를 꺼낸다.
API 키: Google AI Studio(https://aistudio.google.com/apikey)에서 무료 발급 → GOOGLE_API_KEY
"""
import logging
import os
import uuid

from .errors import AnalysisError
from .prompts import SYSTEM_PROMPT
from .schema import AnalysisReport

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
APP_NAME = "business_improvement_assistant"
logging.getLogger("google_adk").setLevel(logging.CRITICAL)  # 오류는 화면 메시지로 안내


def gemini_key_available() -> bool:
    if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
    return bool(os.getenv("GOOGLE_API_KEY"))


def _friendly_error(text: str) -> AnalysisError:
    """Gemini/ADK 오류 문자열을 사용자용 한국어 메시지로 변환."""
    t = text or ""
    if "API_KEY_INVALID" in t or "API key not valid" in t or "PERMISSION_DENIED" in t or t.startswith(("401", "403")):
        return AnalysisError("Google API 키가 올바르지 않습니다. GOOGLE_API_KEY 환경변수를 확인해 주세요.", retryable=False)
    if "RESOURCE_EXHAUSTED" in t or "429" in t[:5] or "quota" in t.lower():
        return AnalysisError("무료 사용량 한도(분당/일일 요청 수)를 초과했습니다. 잠시 후 다시 시도해 주세요.")
    if "NOT_FOUND" in t or t.startswith("404") or "bare model name" in t:
        return AnalysisError(f"모델 '{GEMINI_MODEL}'을(를) 찾을 수 없습니다. GEMINI_MODEL 환경변수를 확인해 주세요.",
                             retryable=False)
    if "UNAVAILABLE" in t or "INTERNAL" in t or t.startswith(("500", "503")):
        return AnalysisError("Gemini 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.")
    if "connect" in t.lower() or "timeout" in t.lower():
        return AnalysisError("AI 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.")
    return AnalysisError(f"AI 분석 중 오류가 발생했습니다: {t[:200]}")


def call_gemini_adk(user_message: str) -> tuple[AnalysisReport, dict]:
    gemini_key_available()
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")

    from google.adk.agents import LlmAgent
    from google.adk.runners import InMemoryRunner
    from google.genai import errors as genai_errors
    from google.genai import types

    agent = LlmAgent(
        name="business_improvement_analyst",
        model=GEMINI_MODEL,
        description="업무 개선 요청을 구조화하고 누락 정보 질문을 생성하는 단일 분석 Agent",
        instruction=SYSTEM_PROMPT,
        output_schema=AnalysisReport,   # 구조화 출력 강제
        output_key="report",            # 결과를 session.state["report"]에 저장
        generate_content_config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=16000),
    )
    runner = InMemoryRunner(agent=agent, app_name=APP_NAME)
    user_id = "local-user"
    session = runner.session_service.create_session_sync(app_name=APP_NAME, user_id=user_id,
                                                         session_id=uuid.uuid4().hex)
    usage = {}
    try:
        for event in runner.run(user_id=user_id, session_id=session.id,
                                new_message=types.Content(role="user", parts=[types.Part(text=user_message)])):
            if getattr(event, "error_message", None) or getattr(event, "error_code", None):
                raise _friendly_error(f"{event.error_code} {event.error_message}")
            um = getattr(event, "usage_metadata", None)
            if um:
                usage = {"input_tokens": um.prompt_token_count, "output_tokens": um.candidates_token_count}
    except AnalysisError:
        raise
    except (genai_errors.ClientError, genai_errors.ServerError) as e:
        raise _friendly_error(f"{getattr(e, 'code', '')} {e}")
    except Exception as e:
        raise _friendly_error(str(e))

    state = runner.session_service.get_session_sync(app_name=APP_NAME, user_id=user_id, session_id=session.id).state
    raw = state.get("report")
    if not raw:
        raise AnalysisError("AI 응답을 보고서 형식으로 받지 못했습니다. 다시 시도해 주세요.")
    try:
        report = AnalysisReport.model_validate(raw) if isinstance(raw, dict) else AnalysisReport.model_validate_json(raw)
    except Exception:
        raise AnalysisError("AI 응답이 보고서 형식과 맞지 않습니다. 다시 시도해 주세요.")
    return report, usage
