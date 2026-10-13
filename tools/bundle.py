#!/usr/bin/env python3
"""사이트 전체를 HTML 파일 하나로 묶는다(글꼴은 쓰인 글자만 남겨 내장).

사용법: python3 tools/bundle.py [출력 파일]   (기본: out/국어학습지.html)
필요: pip install fonttools brotli
지문에 없는 글자는 내장 글꼴에 없으므로 인터넷의 KoPubWorld(jsdelivr)로, 그것도 안 되면 기본 글꼴로 표시된다.
"""
import base64, io, re, sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'out' / '국어학습지.html'

manifest = (ROOT / 'data/manifest.js').read_text(encoding='utf-8')
ids = re.findall(r"'([a-z0-9_-]+)'", manifest.split('[', 1)[1])
data = [(ROOT / f'data/passages/{i}.js').read_text(encoding='utf-8') for i in ids]
js = [(ROOT / p).read_text(encoding='utf-8') for p in ('js/registry.js', 'js/app.js', 'js/annotate.js')]
css = {p: (ROOT / p).read_text(encoding='utf-8') for p in ('css/fonts.css', 'css/app.css', 'css/sheet.css', 'css/annotate.css')}
# PDF 표시하기용 라이브러리 (pdf.js 워커는 같은 스레드에서 돌도록 일반 스크립트로 넣는다)
vendor = [(ROOT / 'vendor' / f).read_text(encoding='utf-8') for f in ('pdf.min.js', 'pdf.worker.min.js', 'pdf-lib.min.js', 'cmaps-ko.js')]
html = (ROOT / 'index.html').read_text(encoding='utf-8')

# 쓰인 글자 + 기본 문장부호·숫자·영문
text = ''.join(data) + ''.join(js) + html
chars = set(text) | set(chr(c) for c in range(0x20, 0x7f)) | set('①②③④⑤⑥⑦⑧⑨⑩→←↔↓▶▼■□○△「」『』‘’“”·…—–')
unicodes = sorted(ord(c) for c in chars if ord(c) >= 0x20)

def subset_font(path):
    font = TTFont(path)
    opts = subset.Options()
    opts.layout_features = ['*']      # 옛한글 조합(ljmo/vjmo/tjmo) 유지
    opts.flavor = 'woff2'
    opts.name_IDs = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = 'woff2'
    font.save(buf)
    return base64.b64encode(buf.getvalue()).decode()

CDN = 'https://cdn.jsdelivr.net/npm/font-kopubworld@1.0.3/fonts/'
faces = []
for fam, file in (('Batang', 'Batang'), ('Dotum', 'Dotum')):
    for w, weight in (('Light', '300'), ('Medium', '400 500'), ('Bold', '600 800')):
        name = f'KoPubWorld-{file}-{w}.woff2'
        b64 = subset_font(ROOT / 'fonts' / name)
        faces.append(f"@font-face{{font-family:'KoPubWorld {fam}';font-weight:{weight};font-display:block;"
                     f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}")
        faces.append(f"@font-face{{font-family:'KoPubWorld {fam} Web';font-weight:{weight};font-display:swap;"
                     f"src:local('KoPubWorld{fam}_Pro {w}'),url({CDN}{name}) format('woff2');}}")
font_css = '\n'.join(faces) + """
:root {
  --f-batang: 'KoPubWorld Batang', 'KoPubWorld Batang Web', 'KoPub Batang', serif;
  --f-dotum: 'KoPubWorld Dotum', 'KoPubWorld Dotum Web', 'KoPub Dotum', sans-serif;
}"""

style = f"<style>\n{font_css}\n{css['css/app.css']}\n{css['css/sheet.css']}\n{css['css/annotate.css']}\n</style>"
def inline(code):
    return '<script>\n' + code.replace('</script', '<\\/script') + '\n</script>'
scripts = '\n'.join(inline(v) for v in vendor) + '\n<script>\n' + '\n'.join(js) + '\nWB.manifest = [];\n' + '\n'.join(data) + '\n</script>'

html = re.sub(r'\s*<link rel="stylesheet"[^>]*>', '', html)
html = re.sub(r'\s*<script src="[^"]*"></script>', '', html)
html = html.replace('</head>', f'{style}\n{scripts}\n</head>')

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out}  {out.stat().st_size / 1024:.0f} KB  (지문 {len(ids)}개, 글자 {len(unicodes)}종)')
