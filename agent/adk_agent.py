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

# 무료 티어 텍스트 모델 (2026-11 Google AI Studio 가격표 기준). 'auto'는 위에서부터 차례로 시도한다.
FREE_MODELS = {
    "gemini-3.8-flash": "Gemini 3.8 Flash — 최신, 기본",
    "gemini-3.6-flash": "Gemini 3.6 Flash — 이전 세대 Flash",
    "gemini-3-flash-preview": "Gemini 3 Flash Preview",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite — 가볍고 빠름",
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite — 가볍고 빠름",
    "gemini-4-hydrogen": "Gemini 4 Hydrogen — 고품질, 느림(1분 이상)",
}
AUTO_CHAIN = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite",
              "gemini-3.5-flash-lite"]
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "auto")  # auto 또는 특정 모델 ID
APP_NAME = "business_improvement_assistant"
logging.getLogger("google_adk").setLevel(logging.CRITICAL)  # 오류는 화면 메시지로 안내


def _windows_user_env(name: str) -> str | None:
    """이미 열려 있던 터미널은 나중에 저장한 사용자 환경변수를 모르므로, Windows 레지스트리에서 직접 읽는다."""
    if os.name != "nt":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return winreg.QueryValueEx(k, name)[0] or None
    except OSError:
        return None


def gemini_key_available() -> bool:
    for name in ("GOOGLE_API_KEY", "GEMINI_API_KEY"):
        if not os.getenv(name) and (v := _windows_user_env(name)):
            os.environ[name] = v.strip()
    if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
    return bool(os.getenv("GOOGLE_API_KEY"))


def _friendly_error(text: str, model: str = "") -> AnalysisError:
    """Gemini/ADK 오류 문자열을 사용자용 한국어 메시지로 변환. switch_model=True면 다른 모델로 넘어가 볼 만한 오류."""
    e = _classify(text or "", model)
    e.switch_model = e.retryable or "찾을 수 없습니다" in str(e)
    return e


def _classify(t: str, model: str) -> AnalysisError:
    if "API_KEY_INVALID" in t or "API key not valid" in t or "PERMISSION_DENIED" in t or t.startswith(("401", "403")):
        return AnalysisError("Google API 키가 올바르지 않습니다. GOOGLE_API_KEY 환경변수를 확인해 주세요.", retryable=False)
    if "RESOURCE_EXHAUSTED" in t or "429" in t[:5] or "quota" in t.lower():
        return AnalysisError("무료 사용량 한도(분당/일일 요청 수)를 초과했습니다. 잠시 후 다시 시도해 주세요.")
    if "NOT_FOUND" in t or t.startswith("404") or "bare model name" in t:
        return AnalysisError(f"모델 '{model}'을(를) 찾을 수 없습니다. GEMINI_MODEL 환경변수를 확인해 주세요.",
                             retryable=False)
    if "UNAVAILABLE" in t or "INTERNAL" in t or t.startswith(("500", "503")):
        return AnalysisError("Gemini 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.")
    if "connect" in t.lower() or "timeout" in t.lower():
        return AnalysisError("AI 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.")
    return AnalysisError(f"AI 분석 중 오류가 발생했습니다: {t[:200]}")


def call_gemini_adk(user_message: str, model: str | None = None) -> tuple[AnalysisReport, dict, str, list]:
    """model='auto'면 AUTO_CHAIN 순서로 시도해, 한도 초과·과부하·모델 없음이면 다음 모델로 넘어간다.
    반환: (보고서, 토큰 사용량, 실제 사용한 모델, 시도 기록)"""
    model = model or GEMINI_MODEL
    chain = AUTO_CHAIN if model == "auto" else [model]
    attempts, last = [], None
    for m in chain:
        try:
            report, usage = _run_once(user_message, m)
            attempts.append({"model": m, "result": "성공"})
            return report, usage, m, attempts
        except AnalysisError as e:
            attempts.append({"model": m, "result": str(e)})
            last = e
            if not getattr(e, "switch_model", False):
                raise
    if len(chain) > 1:
        raise AnalysisError("무료 모델이 모두 한도 초과 또는 혼잡 상태입니다. 1~2분 뒤 다시 시도해 주세요. "
                            + " / ".join(f"{a['model']}: {a['result'][:30]}" for a in attempts))
    raise last


def _run_once(user_message: str, model: str) -> tuple[AnalysisReport, dict]:
    gemini_key_available()
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")

    from google.adk.agents import LlmAgent
    from google.adk.runners import InMemoryRunner
    from google.genai import errors as genai_errors
    from google.genai import types

    agent = LlmAgent(
        name="business_improvement_analyst",
        model=model,
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
                raise _friendly_error(f"{event.error_code} {event.error_message}", model)
            um = getattr(event, "usage_metadata", None)
            if um:
                usage = {"input_tokens": um.prompt_token_count, "output_tokens": um.candidates_token_count}
    except AnalysisError:
        raise
    except (genai_errors.ClientError, genai_errors.ServerError) as e:
        raise _friendly_error(f"{getattr(e, 'code', '')} {e}", model)
    except Exception as e:
        raise _friendly_error(str(e), model)

    state = runner.session_service.get_session_sync(app_name=APP_NAME, user_id=user_id, session_id=session.id).state
    raw = state.get("report")
    if not raw:
        raise AnalysisError("AI 응답을 보고서 형식으로 받지 못했습니다. 다시 시도해 주세요.")
    try:
        report = AnalysisReport.model_validate(raw) if isinstance(raw, dict) else AnalysisReport.model_validate_json(raw)
    except Exception:
        raise AnalysisError("AI 응답이 보고서 형식과 맞지 않습니다. 다시 시도해 주세요.")
    return report, usage
