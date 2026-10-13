#!/usr/bin/env python3
"""'PDF 표시하기'로 저장한 PDF에서 표시(담기·버리기·중요·메모)를 읽는다.

사용법: python3 tools/read_marks.py <표시.pdf> [출력 폴더]
- 표시 목록과 전체 메모를 출력하고, 각 표시 상자 안의 PDF 글자를 뽑아 보여 준다.
- 출력 폴더에 쪽별 이미지(표시 포함, page-N.png)와 상자별 잘라낸 이미지(mark-N.png)를 만든다.
  옛한글·필기처럼 글자 추출이 깨지는 부분은 이 이미지를 직접 보고 판단한다.
필요: pip install pymupdf
"""
import json, sys
from pathlib import Path
import pymupdf

if len(sys.argv) < 2:
    sys.exit(__doc__)
src = Path(sys.argv[1])
out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('out') / (src.stem + '_marks')
out.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(src)

data = None
if 'workbook-marks.json' in doc.embfile_names():
    data = json.loads(doc.embfile_get('workbook-marks.json').decode('utf-8'))

marks = []
if data:
    for m in data['marks']:
        marks.append({**m, 'rect': pymupdf.Rect(m['boxTopLeft'])})
    n_pages = data['originalPages']
else:
    # JSON이 없으면(다른 프로그램에서 고친 경우) 주석에서 읽는다
    n_pages = doc.page_count
    for pno in range(doc.page_count):
        for a in doc[pno].annots() or []:
            if a.info.get('title') != '학습지 표시':
                continue
            c = a.info.get('content', '')
            kind, _, memo = c.partition('] ')
            marks.append({'no': len(marks) + 1, 'page': pno + 1, 'kind': kind.strip('['), 'memo': memo,
                          'whole': False, 'rect': a.rect})

print(f'파일: {src.name}  (원본 {n_pages}쪽' + (f', 뒤 {doc.page_count - n_pages}쪽은 표시 목록' if doc.page_count > n_pages else '') + ')')
if data and data.get('note'):
    print(f'\n[전체 메모]\n{data["note"]}')
print(f'\n[표시 {len(marks)}개]')
for m in marks:
    page = doc[m['page'] - 1]
    r = m['rect']
    text = page.get_textbox(r).strip() if not m.get('whole') else '(쪽 전체)'
    print(f"\n#{m['no']}  {m['page']}쪽  {m['kind']}" + (f"  — {m['memo']}" if m.get('memo') else ''))
    print('   ' + (text.replace('\n', '\n   ') if text else '(추출된 글자 없음 — 이미지 확인)'))
    if not m.get('whole'):
        clip = (r + (-6, -18, 6, 6)) & page.rect
        page.get_pixmap(dpi=160, clip=clip).save(out / f"mark-{m['no']}.png")

for pno in sorted({m['page'] for m in marks}):
    doc[pno - 1].get_pixmap(dpi=110).save(out / f'page-{pno}.png')
print(f'\n이미지: {out}/ (page-N.png = 표시가 그려진 쪽, mark-N.png = 상자 부분)')
