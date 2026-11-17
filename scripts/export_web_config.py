"""Python Agent의 프롬프트·스키마·샘플·Gemini 평가 결과를 웹(GitHub Pages)용 파일로 내보낸다.

웹 버전과 Python(ADK) 버전이 같은 분석 원칙과 보고서 형식을 쓰도록, 원본은 항상 agent/ 쪽에 두고
이 스크립트로 web/config.js, web/data/*.json 을 생성한다.

사용법: python scripts/export_web_config.py
"""
import copy
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.prompts import SYSTEM_PROMPT  # noqa: E402
from agent.schema import AnalysisReport  # noqa: E402

WEB = ROOT / "web"


def inline_refs(schema: dict) -> dict:
    """$ref/$defs를 펼치고 title을 제거해 Gemini responseJsonSchema가 바로 쓸 수 있게 한다."""
    defs = schema.get("$defs", {})

    def walk(node, is_properties=False):
        if isinstance(node, dict):
            if "$ref" in node and not is_properties:
                return walk(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
            if is_properties:  # 키가 필드 이름이므로 'title' 같은 필드명도 그대로 유지
                return {k: walk(v) for k, v in node.items()}
            return {k: walk(v, is_properties=(k == "properties")) for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(schema)


def main():
    schema = inline_refs(AnalysisReport.model_json_schema())
    (WEB / "data").mkdir(parents=True, exist_ok=True)
    (WEB / "config.js").write_text(
        "// 자동 생성 파일 — scripts/export_web_config.py 로 다시 만드세요 (원본: agent/prompts.py, agent/schema.py)\n"
        f"export const SYSTEM_PROMPT = {json.dumps(SYSTEM_PROMPT, ensure_ascii=False)};\n"
        f"export const REPORT_SCHEMA = {json.dumps(schema, ensure_ascii=False, indent=1)};\n",
        encoding="utf-8")
    shutil.copy(ROOT / "samples" / "test_cases.json", WEB / "data" / "test_cases.json")

    results = {}
    for f in sorted((ROOT / "eval" / "results" / "gemini").glob("T*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        results[d["input"]["id"]] = {"metrics": d["metrics"], "guardrail_log": d["guardrail_log"], "report": d["report"]}
    (WEB / "data" / "sample_results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"web/config.js, web/data/test_cases.json, web/data/sample_results.json ({len(results)}건) 생성")


if __name__ == "__main__":
    main()
