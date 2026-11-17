"""AI 업무 개선 요청 분석 Assistant — Streamlit 웹앱 (Python + Google ADK 버전).

실행: python -m streamlit run app.py
"""
import json
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from agent import (ENGINE_LABELS, FREE_MODELS, AnalysisError, analyze, available_engines, to_html,
                   validate_input)
from agent.documents import SUPPORTED, load_document, load_path

st.set_page_config(page_title="업무 개선 분석 Assistant", page_icon="◆", layout="wide")

SAMPLES = json.loads((Path(__file__).parent / "samples" / "test_cases.json").read_text(encoding="utf-8"))
ss = st.session_state
for k, v in {"task_name": "", "problem": "", "improvement": "", "result": None, "answers": [],
             "error": None, "last_args": None, "sample_docs": []}.items():
    ss.setdefault(k, v)

# 화면 전체를 보고서와 같은 톤(아이보리·클레이·세리프 제목)으로
st.markdown("""
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@600&display=swap" rel="stylesheet">
<style>
  html, body, [class*="css"], .stMarkdown, .stTextInput, .stTextArea { font-family: "Noto Sans KR", system-ui, sans-serif; }
  h1, h2, h3 { font-family: "Noto Serif KR", Georgia, serif !important; font-weight: 600 !important; letter-spacing: -.01em; }
  .eyebrow { color: #b35a3c; font-weight: 700; letter-spacing: .12em; font-size: .78rem; text-transform: uppercase; }
  .eyebrow::before { content: "◆ "; color: #d97757; }
  .lead { color: #3d3d3a; font-size: 1.02rem; max-width: 64ch; }
  .how { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0 8px; }
  .how div { background: #fff; border: 1px solid #e8e6dc; border-radius: 14px; padding: 12px 16px; }
  .how b { font-family: "Noto Serif KR", serif; color: #d97757; margin-right: 8px; font-size: 1.2rem; }
  .how span { color: #73726c; font-size: .85rem; display: block; }
  div[data-testid="stForm"] { background: #fff; border: 1px solid #e8e6dc; border-radius: 18px; padding: 8px 18px 18px; }
</style>""", unsafe_allow_html=True)


def load_sample():
    s = next(x for x in SAMPLES if f"{x['id']} · {x['title']}" == ss.sample_pick)
    ss.task_name, ss.problem, ss.improvement = s["task_name"], s["problem"], s["improvement"]
    ss.result, ss.answers, ss.error = None, [], None
    ss.sample_docs = [load_path(Path(__file__).parent / d["path"], d.get("kind")) for d in s.get("documents", [])]


def collect_documents() -> list:
    """업로드한 파일 + 샘플 문서를 참고 문서 목록으로. 읽기 실패는 오류로 알린다."""
    docs = list(ss.sample_docs)
    for f in ss.get("doc_files") or []:
        docs.append(load_document(f.name, f.getvalue()))
    return docs


def run(answers):
    try:
        documents = collect_documents()
    except AnalysisError as e:
        ss.error = (str(e), False)
        return
    args = dict(task_name=ss.task_name, problem=ss.problem, improvement=ss.improvement,
                answers=answers or None, mode=ss.mode, gemini_model=ss.get("gemini_model"), documents=documents)
    ss.last_args = args
    label = ENGINE_LABELS[ss.mode] + (f" · {ss.get('gemini_model')}" if ss.mode == "gemini" else "")
    try:
        with st.status(f"AI Assistant가 요청을 분석하고 있습니다… [{label}] (보통 15~60초)", expanded=True) as status:
            st.write("STEP 1 · 입력 검증 완료" + (f" · 참고 문서 {len(documents)}건" if documents else ""))
            st.write("STEP 2 · 요구사항 구조화 · 누락 정보 식별 · 질문 생성 중… (한도 초과·혼잡 시 다음 무료 모델로 자동 전환)")
            ss.result = analyze(**args)
            st.write("STEP 3 · 근거 검증(가드레일) 완료")
            st.write("STEP 4 · 보고서 생성 완료")
            status.update(label=f"분석 완료 · {ss.result.model} · {ss.result.elapsed_sec}초", state="complete", expanded=False)
        ss.answers, ss.error = answers or [], None
    except AnalysisError as e:
        ss.error = (str(e), e.retryable)
    except Exception as e:  # 예상하지 못한 오류도 사용자 메시지로
        ss.error = (f"예상하지 못한 오류가 발생했습니다: {e}", True)


# ---------------- Sidebar ----------------
with st.sidebar:
    st.header("설정")
    engines = available_engines()
    if "gemini" in engines:
        st.success("Google API 키 감지됨 — Gemini(무료) 분석 사용 가능")
    else:
        st.warning("GOOGLE_API_KEY 환경변수가 없습니다. Google AI Studio에서 무료 키를 발급해 설정하세요. "
                   "지금은 규칙 기반 데모 모드로만 동작합니다.")
    ss.mode = st.radio("분석 엔진", engines, format_func=lambda m: ENGINE_LABELS[m])
    if ss.mode == "gemini":
        st.selectbox("Gemini 모델", ["auto", *FREE_MODELS], key="gemini_model",
                     format_func=lambda m: "자동 선택 (권장) — 실패 시 다음 모델로 전환" if m == "auto" else FREE_MODELS[m])
    st.divider()
    st.subheader("샘플 업무 사례")
    st.selectbox("테스트 사례 선택", [f"{s['id']} · {s['title']}" for s in SAMPLES], key="sample_pick")
    st.button("샘플 불러오기", on_click=load_sample, use_container_width=True)
    st.divider()
    st.caption("🔒 가상·익명화된 업무 사례만 입력하세요. 실제 기밀정보·개인정보는 입력하지 마세요. "
               "입력 내용은 저장되지 않으며, 분석을 위해 선택한 AI 서비스(Google Gemini 등)로 전송됩니다. "
               "Gemini 무료 티어는 입력이 Google 제품 개선에 활용될 수 있습니다.")

# ---------------- Main: 입력 (F01) ----------------
st.markdown('<div class="eyebrow">AI Business Improvement Assistant</div>', unsafe_allow_html=True)
st.title("업무 개선 요청을 검토 가능한 보고서로")
st.markdown('<p class="lead">현업의 업무 개선 요청을 자유롭게 적으면, AI가 현재 업무와 문제점을 구조화하고 빠진 정보를 질문으로 '
            '정리해 IT 담당자·BA가 바로 검토할 수 있는 분석 보고서 초안을 만듭니다.</p>'
            '<div class="how"><div><b>1</b>요청 입력<span>업무명과 불편한 점을 자유롭게</span></div>'
            '<div><b>2</b>AI 분석<span>확인·추정·미확인을 구분해 구조화</span></div>'
            '<div><b>3</b>보고서 검토<span>질문에 답하면 보고서가 갱신</span></div></div>', unsafe_allow_html=True)

with st.form("request_form"):
    st.markdown("#### STEP 0 · 업무 개선 요청")
    st.text_input("업무명 *", key="task_name", placeholder="예: 구매 요청 승인 프로세스")
    st.text_area("현재 업무 및 문제점 *", key="problem", height=150,
                 placeholder="지금 어떻게 일하고 있는지, 무엇이 불편한지 자유롭게 적어 주세요.")
    st.text_area("개선하고 싶은 내용 (선택)", key="improvement", height=80,
                 placeholder="예: 진행 상태를 한눈에 보고 싶습니다.")
    st.file_uploader("참고 문서 (선택) — 현재 쓰는 SOP, 정책·규정, 업무 매뉴얼", key="doc_files",
                     type=[x.lstrip(".") for x in SUPPORTED], accept_multiple_files=True,
                     help="문서의 절차·규정을 근거로 분석하고, 문서와 실제 업무의 차이를 찾습니다. 합계 10만 자 이하, 민감정보는 지운 뒤 사용하세요.")
    if ss.sample_docs:
        st.caption("📄 샘플 참고 문서가 함께 분석됩니다: " + ", ".join(d["name"] for d in ss.sample_docs))
    submitted = st.form_submit_button("분석 시작", type="primary", use_container_width=True)

if submitted:
    errs = validate_input(ss.task_name, ss.problem)
    if errs:
        for e in errs:
            st.error(e)
    else:
        run([])

if ss.error:
    msg, retryable = ss.error
    st.error(f"분석에 실패했습니다. {msg}")
    if retryable and ss.last_args and st.button("다시 시도"):
        run(ss.last_args.get("answers") or [])
        st.rerun()

# ---------------- 결과 (F02~F06) ----------------
res = ss.result
if res:
    r = res.report
    st.divider()
    if res.mode == "demo":
        st.info("현재 결과는 **규칙 기반 데모 모드**(AI 미사용)입니다. AI 분석과 비교하기 위한 기준선입니다.")
    if len(res.attempts) > 1:
        tried = ", ".join(f"{a['model']}({a['result'][:20]})" for a in res.attempts[:-1])
        st.info(f"🔁 {tried} → **{res.model}**로 자동 전환해 분석했습니다.")

    html = to_html(res, ss.answers)
    c1, c2 = st.columns([3, 1])
    c1.markdown(f"### 분석 보고서 — {r.task_name}")
    c2.download_button("⬇ HTML 보고서 다운로드", html, file_name=f"분석보고서_{r.task_name}.html",
                       mime="text/html", type="primary", use_container_width=True)

    tab_report, tab_q, tab_raw = st.tabs(["📋 보고서 (STEP 1~7)", "❓ 추가 질문 답변", "🧩 원본 데이터"])
    with tab_report:
        components.html(html, height=1500, scrolling=True)

    with tab_q:  # F05
        if not r.questions:
            st.write("추가 질문이 없습니다.")
        else:
            st.write("알고 있는 항목만 답해 주세요. 답변을 원문에 더해 보고서를 다시 분석합니다.")
            with st.form("answer_form"):
                inputs = [(q, st.text_input(f"Q{i}. [{q.category}] {q.question}", key=f"ans_{i}_{len(ss.answers)}"))
                          for i, q in enumerate(r.questions, 1)]
                again = st.form_submit_button("답변 반영하여 보고서 갱신", type="primary")
            if again:
                new = [{"question": q.question, "answer": a} for q, a in inputs if a.strip()]
                if not new:
                    st.warning("최소 1개 이상 답변을 입력해 주세요.")
                else:
                    run(ss.answers + new)
                    st.rerun()
        if ss.answers:
            st.markdown("**지금까지 반영된 답변**")
            for a in ss.answers:
                st.markdown(f"- Q. {a['question']}  \n  A. {a['answer']}")

    with tab_raw:
        st.json(r.model_dump())
        st.caption(f"모델: {res.model} · 토큰: {res.usage} · 시도: {res.attempts}")
