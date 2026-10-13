/* PDF 표시 — 교과서 PDF에 "담기 / 버리기 / 중요 / 메모" 상자를 그려 Claude에게 보낼 PDF로 저장 */
(function () {
  'use strict';

  const KINDS = {
    keep: { label: '담기', color: '#2e9d5b', hint: '학습지에 꼭 넣을 부분' },
    drop: { label: '버리기', color: '#d64545', hint: '학습지에서 뺄 부분' },
    key:  { label: '중요', color: '#e08a1f', hint: '강조·빈칸 후보로 삼을 핵심' },
    memo: { label: '메모', color: '#3b6fd6', hint: '요청·질문 (메모에 적기)' },
  };
  const ORDER = ['keep', 'drop', 'key', 'memo'];
  const MARK_TITLE = '학습지 표시';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
  };

  const st = {
    kind: 'keep',
    file: null, bytes: null, pdf: null,
    pages: [],          // { vp (배율 1 viewport), el, rendered }
    marks: [],          // { id, page, kind, x, y, w, h, memo, whole? }  좌표 = 배율 1 viewport(pt, 왼쪽 위 기준)
    note: '',
    sel: null,
  };
  const key = () => st.file && `wb:pdfmarks:${st.file.name}:${st.file.size}`;
  const save = () => { if (key()) store.set(key(), { marks: st.marks, note: st.note }); };

  /* ---------- 라이브러리 ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('불러오기 실패: ' + src));
      document.head.appendChild(s);
    });
  }
  let libs;
  function ensureLibs() {
    // 묶음 파일(bundle)에는 이미 들어 있다. 워커 스크립트를 페이지에 직접 넣으면 pdf.js가 같은 스레드에서 처리한다(file://에서도 동작).
    libs = libs || (async () => {
      if (!window.pdfjsLib) await loadScript('vendor/pdf.min.js');
      if (!window.pdfjsWorker) await loadScript('vendor/pdf.worker.min.js');
      if (!window.PDFLib) await loadScript('vendor/pdf-lib.min.js');
      if (!WB.CMAPS) await loadScript('vendor/cmaps-ko.js').catch(() => {});
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    })();
    return libs;
  }
  class InlineCMapReader {
    constructor() {}
    async fetch({ name }) {
      const b64 = (WB.CMAPS || {})[name];
      if (!b64) throw new Error('CMap 없음: ' + name);
      const bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { cMapData: u8, compressionType: 1 };
    }
  }

  /* ---------- 화면 ---------- */
  function shell() {
    const root = $('#pdfmark');
    if (root.dataset.ready) return;
    root.dataset.ready = '1';
    root.innerHTML = `
      <aside class="pm-side">
        <h1>PDF 표시하기</h1>
        <p class="pm-lead">교과서 PDF에 상자를 그려 학습지에 <b>담을 것</b>과 <b>버릴 것</b>을 표시한 뒤, 저장한 PDF를 Claude에게 보내세요.</p>
        <label class="pm-open"><input type="file" accept="application/pdf" hidden>PDF 열기</label>
        <p class="pm-file" id="pm-file">열린 파일 없음 — PDF를 이 창에 끌어다 놓아도 됩니다.</p>

        <h2>표시 종류 <small>(숫자키 1~4)</small></h2>
        <div class="pm-kinds">${ORDER.map((k, i) => `
          <button type="button" data-kind="${k}" style="--c:${KINDS[k].color}">
            <span class="sw"></span><b>${KINDS[k].label}</b><small>${KINDS[k].hint}</small><kbd>${i + 1}</kbd>
          </button>`).join('')}</div>

        <h2>전체 메모</h2>
        <textarea id="pm-note" rows="3" placeholder="예) 제망매가만 만들어 줘. 시조 두 수는 다음에."></textarea>

        <h2>표시 목록 <small id="pm-count"></small></h2>
        <ol id="pm-list" class="pm-list"></ol>

        <div class="pm-actions">
          <button type="button" id="pm-export" class="primary" disabled>표시한 PDF 저장</button>
          <button type="button" id="pm-clear" disabled>표시 모두 지우기</button>
        </div>
        <p class="pm-tip">페이지 위에서 드래그하면 상자가 생깁니다. 상자를 누르면 선택, 두 번 누르거나 <kbd>Enter</kbd>로 메모 쓰기, <kbd>Delete</kbd>로 삭제. 메모 칸에서 <kbd>Enter</kbd>/<kbd>Esc</kbd>로 빠져나옵니다.</p>
      </aside>
      <div class="pm-pages" id="pm-pages"><div class="pm-drop">PDF 열기 또는 끌어다 놓기</div></div>`;

    $('input[type=file]', root).addEventListener('change', (e) => e.target.files[0] && openFile(e.target.files[0]));
    root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('dragging'); });
    root.addEventListener('dragleave', () => root.classList.remove('dragging'));
    root.addEventListener('drop', (e) => {
      e.preventDefault(); root.classList.remove('dragging');
      const f = [...e.dataTransfer.files].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
      if (f) openFile(f);
    });
    $$('[data-kind]', root).forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    $('#pm-note').addEventListener('input', (e) => { st.note = e.target.value; save(); });
    $('#pm-export').addEventListener('click', exportPdf);
    $('#pm-clear').addEventListener('click', () => {
      if (!st.marks.length || !confirm('표시를 모두 지울까요?')) return;
      st.marks = []; st.sel = null; save(); drawMarks();
    });
    document.addEventListener('keydown', onKey);
    setKind(st.kind);
  }

  function setKind(k) {
    st.kind = k;
    $$('#pdfmark [data-kind]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.kind === k));
  }

  function onKey(e) {
    if ($('#pdfmark').hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      if (e.key === 'Escape' || (e.key === 'Enter' && document.activeElement.tagName === 'INPUT')) document.activeElement.blur();
      return;
    }
    if (e.key === 'Enter' && st.sel) { e.preventDefault(); editMemo(st.sel); return; }
    const n = +e.key;
    if (n >= 1 && n <= 4) { setKind(ORDER[n - 1]); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) {
      e.preventDefault();
      removeMark(st.sel);
    }
  }

  /* ---------- 열기 · 그리기 ---------- */
  async function openFile(file) {
    $('#pm-file').textContent = '불러오는 중…';
    await ensureLibs();
    st.file = file;
    st.bytes = new Uint8Array(await file.arrayBuffer());
    st.pdf = await pdfjsLib.getDocument({ data: st.bytes.slice(), CMapReaderFactory: InlineCMapReader, cMapPacked: true, isEvalSupported: false }).promise;
    const saved = store.get(key(), { marks: [], note: '' });
    st.marks = saved.marks; st.note = saved.note; st.sel = null;
    $('#pm-note').value = st.note;
    $('#pm-file').textContent = `${file.name} · ${st.pdf.numPages}쪽`;
    $('#pm-export').disabled = $('#pm-clear').disabled = false;

    const wrap = $('#pm-pages');
    wrap.innerHTML = '';
    st.pages = [];
    for (let i = 0; i < st.pdf.numPages; i++) {
      const page = await st.pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const el = document.createElement('section');
      el.className = 'pm-page';
      el.dataset.page = i;
      el.innerHTML = `
        <header><b>${i + 1}쪽</b>
          <span class="pm-whole">쪽 전체:
            <button type="button" data-whole="keep">담기</button>
            <button type="button" data-whole="drop">버리기</button></span></header>
        <div class="pm-sheet" style="aspect-ratio:${vp.width} / ${vp.height}">
          <canvas></canvas><div class="pm-layer"></div>
        </div>`;
      wrap.appendChild(el);
      st.pages.push({ page, vp, el, rendered: false });
      bindPage(i);
    }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (en.isIntersecting) renderPage(+en.target.dataset.page);
    }), { rootMargin: '600px 0px' });
    st.pages.forEach((p) => io.observe(p.el));
    drawMarks();
  }

  async function renderPage(i) {
    const p = st.pages[i];
    if (p.rendered) return;
    p.rendered = true;
    const canvas = $('canvas', p.el);
    const cssW = $('.pm-sheet', p.el).clientWidth;
    const scale = (cssW / p.vp.width) * Math.min(2, window.devicePixelRatio || 1) * 1.25;
    const vp = p.page.getViewport({ scale });
    canvas.width = vp.width; canvas.height = vp.height;
    await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }

  function bindPage(i) {
    const p = st.pages[i];
    const sheet = $('.pm-sheet', p.el);
    const layer = $('.pm-layer', p.el);
    $$('[data-whole]', p.el).forEach((b) => b.addEventListener('click', () => {
      addMark({ page: i, kind: b.dataset.whole, x: 0, y: 0, w: p.vp.width, h: p.vp.height, whole: true });
    }));
    layer.addEventListener('dblclick', (e) => {
      const box = e.target.closest('.pm-box');
      if (box) editMemo(box.dataset.id);
    });
    let start = null, ghost = null;
    const toPt = (e) => {
      const r = sheet.getBoundingClientRect();
      return {
        x: Math.min(Math.max(e.clientX - r.left, 0), r.width) / r.width * p.vp.width,
        y: Math.min(Math.max(e.clientY - r.top, 0), r.height) / r.height * p.vp.height,
      };
    };
    layer.addEventListener('pointerdown', (e) => {
      const box = e.target.closest('.pm-box');
      if (box) { select(box.dataset.id); return; }
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      start = toPt(e);
      ghost = document.createElement('div');
      ghost.className = 'pm-box ghost';
      ghost.style.setProperty('--c', KINDS[st.kind].color);
      layer.appendChild(ghost);
    });
    layer.addEventListener('pointermove', (e) => {
      if (!start) return;
      const q = toPt(e);
      place(ghost, p.vp, { x: Math.min(start.x, q.x), y: Math.min(start.y, q.y), w: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) });
    });
    layer.addEventListener('pointerup', (e) => {
      if (!start) return;
      const q = toPt(e);
      const m = { page: i, kind: st.kind, x: Math.min(start.x, q.x), y: Math.min(start.y, q.y), w: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) };
      start = null; ghost.remove(); ghost = null;
      if (m.w > 4 && m.h > 4) addMark(m);
      else select(null);
    });
  }

  function place(el, vp, m) {
    el.style.left = (m.x / vp.width * 100) + '%';
    el.style.top = (m.y / vp.height * 100) + '%';
    el.style.width = (m.w / vp.width * 100) + '%';
    el.style.height = (m.h / vp.height * 100) + '%';
  }

  function sorted() {
    return st.marks.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  }

  function addMark(m) {
    m.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    m.memo = m.memo || '';
    st.marks.push(m);
    save();
    st.sel = m.id;
    drawMarks();
  }

  // 상자를 두 번 누르면 그 상자의 메모 칸으로 간다 (숫자키 단축키와 섞이지 않도록 자동으로 옮기지는 않음)
  function editMemo(id) {
    select(id);
    const inp = $(`#pm-list [data-id="${id}"] input`);
    if (inp) { inp.scrollIntoView({ block: 'nearest' }); inp.focus(); }
  }

  function removeMark(id) {
    st.marks = st.marks.filter((m) => m.id !== id);
    if (st.sel === id) st.sel = null;
    save(); drawMarks();
  }

  function select(id) {
    st.sel = id;
    $$('#pdfmark .pm-box').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    $$('#pm-list li').forEach((li) => li.classList.toggle('sel', li.dataset.id === id));
  }

  function drawMarks() {
    const list = sorted();
    const no = new Map(list.map((m, i) => [m.id, i + 1]));
    st.pages.forEach((p, i) => {
      const layer = $('.pm-layer', p.el);
      $$('.pm-box', layer).forEach((b) => b.remove());
      st.marks.filter((m) => m.page === i).forEach((m) => {
        const b = document.createElement('div');
        b.className = 'pm-box' + (m.whole ? ' whole' : '') + (m.id === st.sel ? ' sel' : '');
        b.dataset.id = m.id;
        b.style.setProperty('--c', KINDS[m.kind].color);
        b.innerHTML = `<span class="pm-tag">${no.get(m.id)} ${KINDS[m.kind].label}${m.memo ? ' · ' + esc(m.memo) : ''}</span>`;
        place(b, p.vp, m);
        layer.appendChild(b);
      });
    });
    $('#pm-count').textContent = list.length ? `${list.length}개` : '';
    $('#pm-list').innerHTML = list.map((m) => `
      <li data-id="${m.id}" class="${m.id === st.sel ? 'sel' : ''}" style="--c:${KINDS[m.kind].color}">
        <span class="no">${no.get(m.id)}</span>
        <span class="pg">${m.page + 1}쪽${m.whole ? ' 전체' : ''}</span>
        <select>${ORDER.map((k) => `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${KINDS[k].label}</option>`).join('')}</select>
        <input type="text" value="${esc(m.memo)}" placeholder="메모 (선택)">
        <button type="button" class="del" title="삭제">×</button>
      </li>`).join('') || '<li class="empty">아직 표시가 없습니다.</li>';
    $$('#pm-list li[data-id]').forEach((li) => {
      const m = st.marks.find((x) => x.id === li.dataset.id);
      $('select', li).addEventListener('change', (e) => { m.kind = e.target.value; save(); drawMarks(); });
      $('input', li).addEventListener('input', (e) => {
        m.memo = e.target.value; save();
        const tag = $(`.pm-box[data-id="${m.id}"] .pm-tag`);
        if (tag) tag.textContent = `${no.get(m.id)} ${KINDS[m.kind].label}${m.memo ? ' · ' + m.memo : ''}`;
      });
      $('.del', li).addEventListener('click', () => removeMark(m.id));
      li.addEventListener('click', (e) => {
        if (e.target.closest('input,select,button')) { select(m.id); return; }
        select(m.id);
        $(`.pm-box[data-id="${m.id}"]`).scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
  }

  /* ---------- 저장: 원본 PDF 위에 상자·이름표 + 주석 + 목록 쪽 + JSON 첨부 ---------- */
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);

  function labelPng(text, color) {
    const S = 4, fs = 10;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = `700 ${fs * S}px 'KoPubWorld Dotum', sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width + 8 * S), h = Math.ceil((fs + 5) * S);
    c.width = w; c.height = h;
    ctx.font = font;
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 4 * S, h / 2 + S * 0.5);
    return { url: c.toDataURL('image/png'), w: w / S, h: h / S };
  }

  function wrapText(ctx, text, maxW) {
    const out = [];
    String(text).split('\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ''; }
        line += ch;
      }
      out.push(line);
    });
    return out;
  }

  // A4 목록 쪽(들)을 그림으로 만든다
  function summaryPages(list, no) {
    const W = 1240, H = 1754, M = 90, pages = [];
    let c, ctx, y;
    const newPage = () => {
      c = document.createElement('canvas'); c.width = W; c.height = H;
      ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1a1d21'; ctx.textBaseline = 'top';
      y = M; pages.push(c);
    };
    newPage();
    ctx.font = "700 44px 'KoPubWorld Dotum', sans-serif";
    ctx.fillText('학습지 제작 표시 목록', M, y); y += 70;
    ctx.font = "400 24px 'KoPubWorld Dotum', sans-serif"; ctx.fillStyle = '#5d636b';
    ctx.fillText(`${st.file.name} · 원본 ${st.pdf.numPages}쪽 · ${new Date().toLocaleString('ko-KR')}`, M, y); y += 46;
    ctx.fillText(ORDER.map((k) => `${KINDS[k].label}: ${KINDS[k].hint}`).join('   '), M, y); y += 56;
    if (st.note.trim()) {
      ctx.fillStyle = '#1a1d21'; ctx.font = "700 28px 'KoPubWorld Dotum', sans-serif";
      ctx.fillText('전체 메모', M, y); y += 42;
      ctx.font = "400 26px 'KoPubWorld Dotum', sans-serif";
      wrapText(ctx, st.note, W - 2 * M).forEach((l) => { ctx.fillText(l, M, y); y += 38; });
      y += 24;
    }
    ctx.strokeStyle = '#1a1d21'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); y += 18;
    list.forEach((m) => {
      ctx.font = "400 26px 'KoPubWorld Dotum', sans-serif";
      const lines = wrapText(ctx, m.memo || '—', W - M - 420);
      const rowH = Math.max(1, lines.length) * 38 + 18;
      if (y + rowH > H - M) newPage();
      ctx.fillStyle = '#1a1d21'; ctx.font = "700 26px 'KoPubWorld Dotum', sans-serif";
      ctx.fillText(String(no.get(m.id)), M, y);
      ctx.font = "400 26px 'KoPubWorld Dotum', sans-serif";
      ctx.fillText(`${m.page + 1}쪽${m.whole ? ' 전체' : ''}`, M + 60, y);
      ctx.fillStyle = KINDS[m.kind].color; ctx.fillRect(M + 200, y - 4, 110, 36);
      ctx.fillStyle = '#fff'; ctx.font = "700 24px 'KoPubWorld Dotum', sans-serif";
      ctx.fillText(KINDS[m.kind].label, M + 214, y + 2);
      ctx.fillStyle = '#1a1d21'; ctx.font = "400 26px 'KoPubWorld Dotum', sans-serif";
      lines.forEach((l, i) => ctx.fillText(l, M + 340, y + i * 38));
      y += rowH;
      ctx.strokeStyle = '#d6dce3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y - 8); ctx.lineTo(W - M, y - 8); ctx.stroke();
    });
    if (!list.length) { ctx.fillStyle = '#5d636b'; ctx.fillText('표시 없음', M, y); }
    return pages;
  }

  async function exportPdf() {
    if (!st.pdf) return;
    const btn = $('#pm-export');
    btn.disabled = true; btn.textContent = '저장 중…';
    try {
      await document.fonts.load("700 20px 'KoPubWorld Dotum'");
      const { PDFDocument, PDFName, PDFHexString, rgb } = PDFLib;
      const doc = await PDFDocument.load(st.bytes, { ignoreEncryption: true });
      const pages = doc.getPages();
      const list = sorted();
      const no = new Map(list.map((m, i) => [m.id, i + 1]));
      const records = [];

      for (const m of list) {
        const n = no.get(m.id), K = KINDS[m.kind], [r, g, b] = hex(K.color);
        const vp = st.pages[m.page].vp;
        const [ax, ay] = vp.convertToPdfPoint(m.x, m.y);
        const [bx, by] = vp.convertToPdfPoint(m.x + m.w, m.y + m.h);
        const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
        const pg = pages[m.page];
        pg.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1,
          color: rgb(r, g, b), opacity: m.whole ? 0.06 : 0.12,
          borderColor: rgb(r, g, b), borderWidth: m.whole ? 3 : 1.5, borderOpacity: 0.95 });
        const memo = m.memo.length > 40 ? m.memo.slice(0, 40) + '…' : m.memo;
        const lab = labelPng(`${n} ${K.label}${memo ? ' · ' + memo : ''}`, K.color);
        const img = await doc.embedPng(lab.url);
        const top = pg.getSize().height;
        const ly = y2 + lab.h + 1 > top ? y2 - lab.h : y2 + 1;
        pg.drawImage(img, { x: x1, y: ly, width: lab.w, height: lab.h });

        const annot = doc.context.obj({
          Type: 'Annot', Subtype: 'Square', Rect: [x1, y1, x2, y2], F: 4,
          C: [r, g, b], Border: [0, 0, 0],
        });
        annot.set(PDFName.of('Contents'), PDFHexString.fromText(`[${K.label}] ${m.memo}`.trim()));
        annot.set(PDFName.of('T'), PDFHexString.fromText(MARK_TITLE));
        annot.set(PDFName.of('NM'), PDFHexString.fromText(`wb-${n}`));
        pg.node.addAnnot(doc.context.register(annot));

        records.push({ no: n, page: m.page + 1, kind: K.label, memo: m.memo, whole: !!m.whole,
          rectPt: [x1, y1, x2, y2].map((v) => +v.toFixed(1)),             // PDF 좌표(왼쪽 아래 기준)
          boxTopLeft: [m.x, m.y, m.x + m.w, m.y + m.h].map((v) => +v.toFixed(1)) });  // 왼쪽 위 기준(PyMuPDF 좌표)
      }

      for (const c of summaryPages(list, no)) {
        const img = await doc.embedPng(c.toDataURL('image/png'));
        const pg = doc.addPage([595.28, 841.89]);
        pg.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
      }

      const json = JSON.stringify({
        tool: 'korean-workbooks PDF 표시', version: 1, file: st.file.name,
        originalPages: st.pdf.numPages, note: st.note, kinds: Object.fromEntries(ORDER.map((k) => [KINDS[k].label, KINDS[k].hint])),
        marks: records,
      }, null, 2);
      await doc.attach(new TextEncoder().encode(json), 'workbook-marks.json', { mimeType: 'application/json', description: '학습지 표시 목록' });
      doc.setSubject('학습지 제작 표시 (담기/버리기/중요/메모)');

      const out = await doc.save();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      a.download = st.file.name.replace(/\.pdf$/i, '') + '_표시.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
      console.error(err);
      alert('저장하지 못했습니다: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '표시한 PDF 저장';
    }
  }

  WB.annotate = {
    show() { shell(); ensureLibs().catch((e) => { $('#pm-file').textContent = e.message; }); },
    openFile,                       // 테스트용
    get state() { return st; },
  };
})();
