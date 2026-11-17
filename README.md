# 🧭 AI 업무 개선 요청 분석 Assistant

현업 부서의 **업무 개선·자동화 요청**(자유 문장)을 AI Agent가 분석해,
요구사항을 표준 항목으로 구조화하고 **추가로 확인할 질문**을 만들고, IT 담당자/BA가 검토할
**분석 보고서 초안(As-Is / To-Be 포함)**을 생성하는 Streamlit 웹서비스입니다.

> Main Quest 2 — "내 도메인에서 AI로 개선 지점 찾아서 PoC 만들기"

| 제출 항목 | 위치 |
|---|---|
| 문제 정의서 | [docs/01_문제정의서.md](docs/01_문제정의서.md) |
| PoC 코드 + 모델 선정 근거 | [agent/](agent/), [app.py](app.py), [docs/02_모델선정근거.md](docs/02_모델선정근거.md) |
| 개선 효과 검증 | [docs/03_개선효과검증.md](docs/03_개선효과검증.md), [eval/](eval/) |
| 실행 방법·시연 | 이 문서 |

---

## 1. 주요 기능 (PRD 대응)
| ID | 기능 | 구현 |
|---|---|---|
| F01 | 업무 개선 요청 입력 | 업무명·문제점(필수), 개선 희망(선택) 입력 + 필수값 검증 메시지 |
| F02 | AI 요구사항 분석 | 업무 목적, AS-IS 절차, 문제점, 개선 목적·기대효과, To-Be 가안, 개선 후보 |
| F03 | 누락 정보 식별·질문 | 7개 점검 범주 기준 최대 10개 질문, 이미 확인된 범주는 질문 제외 |
| F04 | 분석 보고서 표시 | 8개 섹션 표준 보고서, 모든 사실에 ✅확인 / 🟡추정 / ⚪미확인 + 근거 표시 |
| F05 | 추가 답변 반영 | 질문에 답하면 원 요청+답변으로 재분석해 보고서 갱신 |
| F06 | 보고서 다운로드 | Markdown 다운로드 |
| 신뢰성 | 가드레일 | '확인'인데 원문에 인용 근거가 없으면 자동으로 '추정'으로 강등하고 교정 내역 표시 |

## 2. 동작 구조 (단일 Agent)
```
[입력] ─▶ ① 입력 검증 ─▶ ② Claude 구조화 분석 (Pydantic 스키마 강제 출력)
                              · 요구사항 구조화 · 누락 정보 식별 · 질문 생성
        ─▶ ③ 가드레일 검증 (원문 인용 대조, 질문 중복/10개 제한)
        ─▶ ④ 보고서 표시 / Markdown 다운로드
        ─▶ (F05) 질문 답변 입력 ─▶ ②~④ 재실행
```
```
app.py                  Streamlit 화면
agent/schema.py         보고서 스키마 (확인/추정/미확인 + 근거)
agent/prompts.py        시스템 프롬프트(분석 원칙)
agent/analyzer.py       Agent 본체: Claude 호출, 오류 처리
agent/guardrails.py     사실 확정 오류 자동 교정
agent/baseline.py       규칙 기반 비교 기준선 / 데모 모드
agent/report.py         Markdown 보고서 생성
samples/test_cases.json PRD 테스트 사례 T01~T05
eval/run_eval.py        일괄 평가 스크립트
```

## 3. 실행 방법
### 3-1. 설치
```bash
pip install -r requirements.txt
```
> Windows의 '스마트 앱 컨트롤'이 켜져 있으면 일부 최신 패키지 DLL(jiter, numpy)이 차단될 수 있습니다.
> requirements.txt는 차단되지 않는 jiter 버전으로 고정했고, 화면은 numpy 없이 동작하도록 만들었습니다.

### 3-2. API 키 설정 (소스코드에 넣지 않음)
PowerShell:
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```
macOS/Linux:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```
API 키가 없으면 **규칙 기반 데모 모드**(AI 미사용)로만 화면이 동작합니다.

### 3-3. 웹앱 실행
```bash
streamlit run app.py
```
브라우저에서 http://localhost:8501 → 왼쪽 **샘플 업무 사례**에서 T01~T05를 불러오거나 직접 입력 → **분석하기**.

### 3-4. 평가 재현
```bash
python eval/run_eval.py --mode claude
```
```bash
python eval/run_eval.py --mode demo
```
결과: `eval/results/<mode>/` 에 사례별 JSON·Markdown 보고서와 `summary.md`(지표 표).

## 4. 시연
> 스크린샷은 `docs/images/`에 저장해 아래에 연결합니다. (Claude 모드 실행 후 캡처)
- 입력 화면 / 분석 진행 상태 / 보고서(확인·추정 배지) / 추가 질문 답변 후 갱신 / Markdown 다운로드

## 5. 보안·개인정보
- 가상 또는 익명화된 업무 사례만 사용합니다. 입력은 저장하지 않으며(세션 메모리에만 존재), 분석을 위해 Anthropic API로 전송됩니다.
- API 키는 환경변수로만 관리합니다.
- AI 결과는 **참고용 초안**이며 사람의 검토가 필요하다는 안내를 화면과 보고서에 표시합니다.

## 6. 한계 및 다음 단계
- 가드레일은 '확인' 항목의 **인용문 존재 여부**만 검사합니다. 인용은 맞지만 해석이 틀린 경우는 사람 검토가 필요합니다.
- 짧은 요청 위주로 설계했습니다. 긴 문서·첨부파일(엑셀, 프로세스 문서) 입력은 다음 단계.
- 다음 단계 후보: 분석 이력 저장, 요청 간 우선순위 평가, 자동화 적합성 점수, 프로세스 다이어그램 시각화, PDF 다운로드,
  Streamlit Community Cloud 배포(외부 테스트용).
- 실제 도입 시 필요: 사내 데이터 처리 정책 검토(외부 API 전송), 비용 산정(요청당 토큰 사용량은 `eval` 결과의 output_tokens 참고), 현업·BA 피드백 수집 루프.
