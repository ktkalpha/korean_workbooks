# 국어 학습지

교과서 지문 하나를 **A4 한 장** 학습지로 만들고, 빈칸을 뚫어 인쇄하는 사이트입니다.
한 장에 **지문 + 교과서식 필기(표시한 부분 바로 밑) + 갈래 및 특성 정리**가 모두 들어갑니다. 컴퓨터에서 쓰고 출력하는 용도입니다.

## 쓰는 법

1. `index.html`을 브라우저(Chrome 권장)로 엽니다. 서버 없이 파일로 열어도 됩니다.
2. 지문을 고릅니다.
3. 빈칸 만들기
   - **빈칸 지정**을 켠 상태에서 필기·핵심어·현대어 풀이를 누르면 빈칸이 되고, 다시 누르면 돌아옵니다.
   - **드래그 빈칸**: 같은 상태에서 학습지의 아무 글자나 드래그하면 그 부분만 빈칸이 됩니다(본문 한 단어, 문장 일부 등). 만든 빈칸을 누르면 없어집니다.
   - **자동 빈칸**: 대상(필기 / 정리 핵심어 / 본문 표시어 / 현대어 풀이)과 비율을 정해 무작위로 뚫습니다. "대상 전부"는 고른 대상을 모두 빈칸으로 만듭니다.
   - **번호**: 빈칸에 번호 표시. **정답 보기**: 빈칸 자리에 정답을 빨갛게 표시.
   - 빈칸 상태는 브라우저에 지문별로 저장됩니다.
4. **학습지 인쇄** / **정답지 인쇄** — 용지 A4, 여백 "없음", 배경 그래픽 켜기.

## PDF 표시하기 (Claude에게 새 지문을 맡길 때)

화면 위 **PDF 표시하기**(`#/pdf`)에서 교과서 PDF를 열고, 페이지 위를 드래그해 상자를 그립니다.

| 종류 (숫자키) | 뜻 |
|---|---|
| 담기 (1) | 학습지에 꼭 넣을 부분 |
| 버리기 (2) | 학습지에서 뺄 부분 |
| 중요 (3) | 강조·빈칸 후보로 삼을 핵심 |
| 메모 (4) | 요청·질문 (메모 칸에 적기) |

- 상자를 두 번 누르거나 선택 후 Enter → 메모 쓰기, Delete → 삭제. 각 쪽 위의 "쪽 전체: 담기/버리기"로 한 쪽을 통째로 표시할 수 있습니다.
- **전체 메모**에 요청을 적고 **표시한 PDF 저장** → `<원본>_표시.pdf`. 이 파일을 Claude에게 보내면 됩니다.
- 저장한 PDF에는 색 상자·이름표, PDF 주석, 끝에 표시 목록 쪽, 내장 JSON(`workbook-marks.json`)이 들어갑니다. Claude는 `tools/read_marks.py`로 읽습니다.
- 표시는 브라우저에 파일별로 저장되어, 같은 PDF를 다시 열면 이어서 할 수 있습니다.

## 파일 하나로 묶기

`python3 tools/bundle.py` → `out/국어학습지.html` 한 파일에 화면·지문·글꼴(쓰인 글자만)을 모두 담습니다. 이 파일만 복사해 어디서든 열 수 있습니다. 지문을 추가했으면 다시 실행하세요.

## 글꼴

KoPubWorld 바탕·돋움(한국출판인회의, `fonts/LICENSE-KoPubWorld.md`)을 `fonts/`에 포함했습니다. 옛한글 조합을 지원합니다.

## 지문 추가

`data/passages/<id>.js`를 만들고 `data/manifest.js`에 id를 적습니다. 형식과 절차는
[`.claude/skills/korean-workbook/SKILL.md`](.claude/skills/korean-workbook/SKILL.md)에 있습니다(Claude Code 스킬 `korean-workbook`).

검사: `NODE_PATH=$(npm root -g) node tools/check.mjs <id> out` — 한 장에 들어가는지, 필기가 겹치지 않는지 확인하고 PNG·PDF를 만듭니다(Playwright 필요).

## 구조

```
index.html              목록 + 학습지 화면
css/fonts.css           KoPubWorld 글꼴
css/sheet.css           A4 학습지 모양 (인쇄)
css/app.css             도구 막대 등 화면 UI
js/registry.js          WB.register
js/app.js               렌더링 · 필기 배치 · 한 장 맞춤 · 빈칸(클릭·드래그·자동)
js/annotate.js          PDF 표시하기
vendor/                 pdf.js · pdf-lib · 한국어 CMap
data/manifest.js        지문 목록
data/passages/*.js      지문 데이터
tools/check.mjs         렌더링 검사
tools/bundle.py         단일 HTML 만들기
tools/read_marks.py     표시한 PDF 읽기
```
