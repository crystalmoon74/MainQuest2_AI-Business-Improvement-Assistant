"""AI 업무 개선 요청 분석 Assistant — Streamlit 웹앱.

실행: streamlit run app.py
"""
import json
from pathlib import Path

import streamlit as st

from agent import ENGINE_LABELS, AnalysisError, analyze, available_engines, to_markdown, validate_input
from agent.report import BADGE, DISCLAIMER, _esc

st.set_page_config(page_title="AI 업무 개선 요청 분석 Assistant", page_icon="🧭", layout="wide")

SAMPLES = json.loads((Path(__file__).parent / "samples" / "test_cases.json").read_text(encoding="utf-8"))
ss = st.session_state
for k, v in {"task_name": "", "problem": "", "improvement": "", "result": None, "answers": [],
             "error": None, "last_args": None}.items():
    ss.setdefault(k, v)


def load_sample():
    s = next(x for x in SAMPLES if f"{x['id']} {x['title']}" == ss.sample_pick)
    ss.task_name, ss.problem, ss.improvement = s["task_name"], s["problem"], s["improvement"]
    ss.result, ss.answers, ss.error = None, [], None


def run(answers):
    args = dict(task_name=ss.task_name, problem=ss.problem, improvement=ss.improvement,
                answers=answers or None, mode=ss.mode)
    ss.last_args = args
    try:
        with st.status(f"AI Assistant가 요청을 분석하고 있습니다… [{ENGINE_LABELS[ss.mode]}] (보통 10~60초)", expanded=True) as status:
            st.write("① 입력 검증 완료")
            st.write("② 요구사항 구조화 · 누락 정보 식별 · 질문 생성 중…")
            ss.result = analyze(**args)
            st.write("③ 근거 검증(가드레일) 완료")
            status.update(label=f"분석 완료 ({ss.result.elapsed_sec}초)", state="complete", expanded=False)
        ss.answers, ss.error = answers or [], None
    except AnalysisError as e:
        ss.error = (str(e), e.retryable)
    except Exception as e:  # 예상하지 못한 오류도 사용자 메시지로
        ss.error = (f"예상하지 못한 오류가 발생했습니다: {e}", True)


def table(rows):
    """numpy/pandas 없이 표 렌더링 (일부 Windows 환경의 DLL 차단 회피)."""
    if not rows:
        return
    cols = list(rows[0].keys())
    md = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    md += ["| " + " | ".join(_esc(str(r.get(c, "")) or "-") for c in cols) + " |" for r in rows]
    st.markdown("\n".join(md))


# ---------------- Sidebar ----------------
with st.sidebar:
    st.header("⚙️ 설정")
    engines = available_engines()
    if "gemini" in engines:
        st.success("Google API 키 감지됨 — Gemini(무료) 분석 사용 가능")
    else:
        st.warning("GOOGLE_API_KEY 환경변수가 없습니다. Google AI Studio에서 무료 키를 발급해 설정하세요. "
                   "지금은 규칙 기반 데모 모드로만 동작합니다.")
    ss.mode = st.radio("분석 엔진", engines, format_func=lambda m: ENGINE_LABELS[m])
    st.divider()
    st.subheader("📂 샘플 업무 사례")
    st.selectbox("테스트 사례 선택", [f"{s['id']} {s['title']}" for s in SAMPLES], key="sample_pick")
    st.button("샘플 불러오기", on_click=load_sample, use_container_width=True)
    st.divider()
    st.caption("🔒 가상·익명화된 업무 사례만 입력하세요. 실제 기밀정보·개인정보는 입력하지 마세요. "
               "입력 내용은 저장되지 않으며, 분석을 위해 선택한 AI 서비스(Google Gemini 등)로 전송됩니다. "
               "Gemini 무료 티어는 입력이 Google 제품 개선에 활용될 수 있습니다.")

# ---------------- Main: 입력 (F01) ----------------
st.title("🧭 AI 업무 개선 요청 분석 Assistant")
st.caption("업무 문제를 편하게 적어 주세요. AI가 요구사항을 정리하고, 추가로 확인할 질문과 분석 보고서 초안을 만들어 드립니다.")

with st.form("request_form"):
    st.text_input("업무명 *", key="task_name", placeholder="예: 구매 요청 승인 프로세스")
    st.text_area("현재 업무 및 문제점 설명 *", key="problem", height=150,
                 placeholder="지금 어떻게 일하고 있는지, 무엇이 불편한지 자유롭게 적어 주세요.")
    st.text_area("개선하고 싶은 내용 (선택)", key="improvement", height=80,
                 placeholder="예: 진행 상태를 한눈에 보고 싶습니다.")
    submitted = st.form_submit_button("🔍 분석하기", type="primary", use_container_width=True)

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
    if retryable and ss.last_args and st.button("🔁 다시 시도"):
        run(ss.last_args.get("answers") or [])
        st.rerun()

# ---------------- 결과 (F02~F06) ----------------
res = ss.result
if res:
    r = res.report
    st.divider()
    st.subheader(f"📄 분석 보고서 — {r.task_name}")
    if res.mode == "demo":
        st.info("현재 결과는 **규칙 기반 데모 모드**(AI 미사용)입니다. AI 분석과 비교하기 위한 기준선입니다.")
    st.markdown(DISCLAIMER)

    c = st.columns(5)
    c[0].metric("분석 시간", f"{res.elapsed_sec}초")
    c[1].metric("주요 문제점", len(r.problems))
    c[2].metric("개선 후보", len(r.candidates))
    c[3].metric("추가 질문", len(r.questions))
    c[4].metric("자동 교정", len(res.guardrail_log), help="원문에 근거가 없는 '확인' 항목을 '추정'으로 강등한 건수 등")

    tab_report, tab_q, tab_md, tab_raw = st.tabs(["📋 보고서", "❓ 추가 질문 답변", "⬇️ 다운로드", "🧩 원본 데이터"])

    with tab_report:
        st.markdown("#### 1. 업무 개요")
        st.write(r.summary)
        st.markdown(f"**업무 목적**: {BADGE[r.task_purpose.status]} {r.task_purpose.content}")

        st.markdown("#### 2. 현재 업무 방식 (AS-IS)")
        st.write(r.as_is_description)
        st.markdown("  →  ".join(f"**{s.step}** {BADGE[s.status].split()[0]}" for s in r.as_is_process))
        table([{"순서": s.order, "업무 단계": s.step, "상태": BADGE[s.status], "근거": s.evidence}
               for s in r.as_is_process])

        def show(items):
            table([{"상태": BADGE[f.status], "내용": f.content, "근거": f.evidence} for f in items])

        st.markdown("#### 3. 주요 문제점")
        show(r.problems)
        st.markdown("#### 4. 개선 목적 및 기대 효과")
        show(r.improvement_goals)
        show(r.expected_effects)
        st.markdown("#### 5. 개선 후 모습 (TO-BE, 검토용 가안)")
        st.write(r.to_be_concept)
        st.markdown("#### 6. 개선 후보 (검토 후보)")
        for i, cand in enumerate(r.candidates, 1):
            with st.expander(f"후보 {i}. {cand.title}  ·  {cand.type}", expanded=i == 1):
                st.write(cand.description)
                st.markdown(f"- **해결 대상 문제**: {cand.related_problem}\n- **기대 효과**: {cand.expected_effect}"
                            f"\n- **검토 전 전제 조건**: {cand.prerequisite}")
        st.markdown("#### 7. 추가 확인 질문")
        for i, q in enumerate(r.questions, 1):
            st.markdown(f"{i}. `{q.category}` {q.question}  \n   <small>└ {q.reason}</small>", unsafe_allow_html=True)
        st.markdown("#### 8. 분석 근거 및 미확인 사항")
        st.write(r.analysis_basis)
        for u in r.unconfirmed:
            st.markdown(f"- ⚪ {u}")
        if res.guardrail_log:
            with st.expander(f"🛡️ 자동 검증(가드레일) 교정 내역 {len(res.guardrail_log)}건"):
                table(res.guardrail_log)

    with tab_q:  # F05
        if not r.questions:
            st.write("추가 질문이 없습니다.")
        else:
            st.write("알고 있는 항목만 답해 주세요. 답변을 반영해 보고서를 다시 분석합니다.")
            with st.form("answer_form"):
                inputs = [(q, st.text_input(f"{i}. [{q.category}] {q.question}", key=f"ans_{i}_{len(ss.answers)}"))
                          for i, q in enumerate(r.questions, 1)]
                again = st.form_submit_button("🔄 답변 반영하여 보고서 갱신", type="primary")
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

    with tab_md:  # F06
        md = to_markdown(res, ss.answers)
        st.download_button("⬇️ Markdown 보고서 다운로드", md, file_name=f"분석보고서_{r.task_name}.md",
                           mime="text/markdown", type="primary")
        st.code(md, language="markdown")

    with tab_raw:
        st.json(r.model_dump())
        st.caption(f"모델: {res.model} · 토큰: {res.usage}")
