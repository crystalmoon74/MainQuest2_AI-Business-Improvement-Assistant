"""참고 문서(SOP, 정책·규정, 업무 매뉴얼) 텍스트 추출.

지원 형식: .txt .md .csv (UTF-8/CP949), .pdf (pypdf, 텍스트가 있는 PDF만), .docx (본문 문단)
결과: {"name": 파일명, "kind": 문서 종류, "text": 본문}
"""
import io
import re
import zipfile
from pathlib import Path

from .errors import AnalysisError
from .prompts import DOC_KINDS, MAX_DOC_CHARS

SUPPORTED = (".txt", ".md", ".csv", ".pdf", ".docx")


def guess_kind(name: str) -> str:
    n = name.lower()
    if "sop" in n or "절차" in n or "프로세스" in n:
        return "SOP"
    if any(k in n for k in ("정책", "규정", "지침", "policy", "전결")):
        return "정책/규정"
    if "매뉴얼" in n or "manual" in n or "가이드" in n:
        return "업무 매뉴얼"
    return "기타"


def extract_text(name: str, data: bytes) -> str:
    ext = Path(name).suffix.lower()
    if ext in (".txt", ".md", ".csv"):
        for enc in ("utf-8-sig", "cp949"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
        raise AnalysisError(f"'{name}'의 글자 인코딩을 읽지 못했습니다. UTF-8로 저장해 주세요.", retryable=False)
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise AnalysisError("PDF를 읽으려면 pypdf가 필요합니다: python -m pip install pypdf", retryable=False)
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        if not text.strip():
            raise AnalysisError(f"'{name}'에서 글자를 찾지 못했습니다. 스캔 이미지 PDF는 지원하지 않습니다.", retryable=False)
        return text
    if ext == ".docx":
        try:
            xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
        except (zipfile.BadZipFile, KeyError):
            raise AnalysisError(f"'{name}'을(를) Word 문서로 읽지 못했습니다.", retryable=False)
        paras = ["".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)) for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)]
        return "\n".join(p for p in paras if p.strip())
    raise AnalysisError(f"'{name}'은(는) 지원하지 않는 형식입니다. ({', '.join(SUPPORTED)})", retryable=False)


def load_document(name: str, data: bytes, kind: str | None = None) -> dict:
    text = re.sub(r"\n{3,}", "\n\n", extract_text(name, data)).strip()
    return {"name": name, "kind": kind if kind in DOC_KINDS else guess_kind(name), "text": text}


def load_path(path: str | Path, kind: str | None = None) -> dict:
    p = Path(path)
    return load_document(p.name, p.read_bytes(), kind)


def check_size(documents: list) -> None:
    total = sum(len(d["text"]) for d in documents)
    if total > MAX_DOC_CHARS:
        sizes = ", ".join(f"{d['name']} {len(d['text']):,}자" for d in documents)
        raise AnalysisError(f"참고 문서가 너무 깁니다(합계 {total:,}자, 최대 {MAX_DOC_CHARS:,}자). "
                            f"관련 부분만 남겨 다시 올려 주세요. ({sizes})", retryable=False)
