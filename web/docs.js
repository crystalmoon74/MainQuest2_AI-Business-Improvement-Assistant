// 참고 문서(SOP, 정책·규정, 업무 매뉴얼) 텍스트 추출 — 브라우저 안에서만 처리하고 서버로 올리지 않는다.
// 지원: .txt .md .csv (UTF-8/CP949), .pdf (pdf.js, 텍스트가 있는 PDF), .docx (JSZip)
// agent/documents.py 와 같은 규칙.
import { DOC_KINDS, MAX_DOC_CHARS } from "./core.js?v=2";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
export const ACCEPT = ".txt,.md,.csv,.pdf,.docx";
export const MAX_FILES = 5;

const loaded = {};
function loadScript(src) {
  loaded[src] ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("문서 처리 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요."));
    document.head.appendChild(s);
  });
  return loaded[src];
}

export function guessKind(name) {
  const n = name.toLowerCase();
  if (/sop|절차|프로세스/.test(n)) return "SOP";
  if (/정책|규정|지침|policy|전결/.test(n)) return "정책/규정";
  if (/매뉴얼|manual|가이드/.test(n)) return "업무 매뉴얼";
  return "기타";
}

async function readText(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("euc-kr").decode(buf); // CP949(한글 윈도우) 파일
}

async function readPdf(file) {
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join(""));
  }
  const text = pages.join("\n");
  if (!text.trim()) throw new Error(`'${file.name}'에서 글자를 찾지 못했습니다. 스캔 이미지 PDF는 지원하지 않습니다.`);
  return text;
}

async function readDocx(file) {
  await loadScript(JSZIP);
  let xml;
  try { xml = await (await window.JSZip.loadAsync(await file.arrayBuffer())).file("word/document.xml").async("string"); }
  catch { throw new Error(`'${file.name}'을(를) Word 문서로 읽지 못했습니다.`); }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return [...doc.getElementsByTagNameNS(W, "p")].map((p) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join(""))
    .filter((t) => t.trim()).join("\n");
}

export async function readDocument(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  let text;
  if ([".txt", ".md", ".csv"].includes(ext)) text = await readText(file);
  else if (ext === ".pdf") text = await readPdf(file);
  else if (ext === ".docx") text = await readDocx(file);
  else throw new Error(`'${file.name}'은(는) 지원하지 않는 형식입니다. (PDF, DOCX, TXT, MD, CSV)`);
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`'${file.name}'에 읽을 수 있는 내용이 없습니다.`);
  return { name: file.name, kind: guessKind(file.name), text };
}

export function checkSize(documents) {
  const total = documents.reduce((n, d) => n + d.text.length, 0);
  if (total > MAX_DOC_CHARS) {
    return `참고 문서가 너무 깁니다(합계 ${total.toLocaleString()}자, 최대 ${MAX_DOC_CHARS.toLocaleString()}자). 관련 부분만 남겨 다시 올려 주세요.`;
  }
  return "";
}

export { DOC_KINDS, MAX_DOC_CHARS };
