"""테스트 사례(T01~T05) 일괄 실행 및 정량 지표 산출.

사용법:
  python eval/run_eval.py --mode gemini   # Google ADK + Gemini 무료 티어 (GOOGLE_API_KEY 필요)
  python eval/run_eval.py --mode claude   # Claude 분석 (ANTHROPIC_API_KEY 필요, 유료)
  python eval/run_eval.py --mode demo     # 규칙 기반 기준선
결과: eval/results/<mode>/<ID>.json, <ID>.md, summary.md
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent import AnalysisError, analyze, to_markdown  # noqa: E402

CHECK_CATS = ["업무 처리 빈도", "평균 처리 시간", "담당자/참여 부서", "사용 중인 시스템", "승인 절차", "예외 처리", "기대 효과"]


def metrics(res):
    r = res.report
    facts = [r.task_purpose, *r.as_is_process, *r.problems, *r.improvement_goals, *r.expected_effects]
    st = {s: sum(f.status == s for f in facts) for s in ("확인", "추정", "미확인")}
    asked = {q.category for q in r.questions}
    covered = sum(c in asked or c in r.confirmed_categories for c in CHECK_CATS)
    dup = sum(q.category in r.confirmed_categories and q.category != "기타" for q in r.questions)
    return {
        "elapsed_sec": res.elapsed_sec,
        "as_is_steps": len(r.as_is_process),
        "problems": len(r.problems),
        "candidates": len(r.candidates),
        "questions": len(r.questions),
        "status_확인": st["확인"], "status_추정": st["추정"], "status_미확인": st["미확인"],
        "guardrail_fixes": len(res.guardrail_log),
        "fabrication_flags": sum(g["type"].startswith("근거 불일치") for g in res.guardrail_log),
        "check_category_coverage": f"{covered}/7",
        "dup_questions_after_guard": dup,
        "output_tokens": res.usage.get("output_tokens", "-"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["gemini", "claude", "demo"], default="gemini")
    ap.add_argument("--only", help="예: T01,T04")
    a = ap.parse_args()

    cases = json.loads((ROOT / "samples" / "test_cases.json").read_text(encoding="utf-8"))
    if a.only:
        cases = [c for c in cases if c["id"] in a.only.split(",")]
    out = ROOT / "eval" / "results" / a.mode
    out.mkdir(parents=True, exist_ok=True)

    rows = []
    for c in cases:
        print(f"[{c['id']}] {c['title']} ...", flush=True)
        try:
            res = analyze(c["task_name"], c["problem"], c["improvement"], mode=a.mode)
        except AnalysisError as e:
            print("   실패:", e)
            rows.append({"id": c["id"], "title": c["title"], "error": str(e)})
            continue
        m = metrics(res)
        (out / f"{c['id']}.json").write_text(json.dumps({"input": c, "metrics": m, "guardrail_log": res.guardrail_log,
                                                         "report": res.report.model_dump()},
                                                        ensure_ascii=False, indent=2), encoding="utf-8")
        (out / f"{c['id']}.md").write_text(to_markdown(res), encoding="utf-8")
        rows.append({"id": c["id"], "title": c["title"], **m})
        print("   ", m, flush=True)

    # 이번 실행에서 실패했거나 --only로 건너뛴 사례는 이전에 저장된 성공 결과를 사용
    done = {r["id"] for r in rows if "error" not in r}
    for c in json.loads((ROOT / "samples" / "test_cases.json").read_text(encoding="utf-8")):
        f = out / f"{c['id']}.json"
        if c["id"] not in done and f.exists():
            rows = [r for r in rows if r["id"] != c["id"]]
            rows.append({"id": c["id"], "title": c["title"], **json.loads(f.read_text(encoding="utf-8"))["metrics"]})
    rows.sort(key=lambda r: r["id"])

    keys = ["id", "title", "elapsed_sec", "as_is_steps", "problems", "candidates", "questions", "status_확인",
            "status_추정", "status_미확인", "fabrication_flags", "check_category_coverage", "dup_questions_after_guard"]
    lines = [f"# 평가 결과 요약 ({a.mode})", "", "| " + " | ".join(keys) + " |", "|" + "---|" * len(keys)]
    for r in rows:
        if "error" in r:
            lines.append(f"| {r['id']} | {r['title']} | 실패: {r['error']} |" + " |" * (len(keys) - 3))
        else:
            lines.append("| " + " | ".join(str(r.get(k, "")) for k in keys) + " |")
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
