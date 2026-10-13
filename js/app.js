/* 국어 학습지 — 렌더링 · 필기 배치 · 빈칸 뚫기 */
(function () {
  'use strict';

  const CATS = {
    note:  '필기',
    key:   '정리 핵심어',
    text:  '본문 표시어',
    trans: '현대어 풀이',
  };
  const DEFAULT_AUTO = { cats: { note: true, key: true, text: false, trans: false }, ratio: 60 };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 저장 (실패해도 동작) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  /* ---------- 마크업 → HTML ---------- */
  // 빈칸 단위 하나를 만든다. ctx.units 에 기록된다.
  function unit(ctx, cat, inner, cls) {
    const id = ctx.prefix + (ctx.n++);
    ctx.units.push({ id, cat });
    return `<span class="bk ${cls || ''}" data-bid="${id}" data-cat="${cat}">${inner}</span>`;
  }

  // {{핵심어}}, **굵게**, 줄바꿈 처리. {{ }} 안은 빈칸 단위가 된다.
  function rich(s, ctx, cat) {
    const re = /\{\{(.+?)\}\}|\*\*(.+?)\*\*|\n/g;
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      if (m[1] != null) out += unit(ctx, cat, esc(m[1]), 'kw');
      else if (m[2] != null) out += `<b>${esc(m[2])}</b>`;
      else out += '<br>';
      last = re.lastIndex;
    }
    return out + esc(s.slice(last));
  }

  // {{ }}가 있으면 그 부분만, 없으면 전체가 하나의 빈칸 단위.
  function blankable(s, ctx, cat) {
    return /\{\{.+?\}\}/.test(s) ? rich(s, ctx, cat) : unit(ctx, cat, rich(s, ctx, cat), 'whole');
  }

  // 각주 번호 ^1 → 위첨자 (이미 escape된 문자열에 적용)
  const fnRefs = (h) => h.replace(/\^(\d+)/g, '<sup class="fn-ref">$1</sup>');

  // 본문 한 줄: [대상]{표시:필기} · [대상]{표시<:필기}(필기를 대상 왼쪽 끝에 맞춤) · ^1
  function parseLine(text, ctx) {
    const re = /\[([^\]]+)\]\{([a-z])(<)?(?::((?:\{\{.*?\}\}|[^}])*))?\}/g;
    let html = '', last = 0, m;
    const notes = [];
    while ((m = re.exec(text))) {
      html += fnRefs(esc(text.slice(last, m.index)));
      const k = notes.length;
      const target = unit(ctx, 'text', fnRefs(esc(m[1])), 'tgt');
      html += `<span class="an m-${m[2]}" data-k="${k}">${target}</span>`;
      notes.push({ k, align: m[3] ? 'start' : 'center', html: m[4] ? blankable(m[4].replace(/\\n/g, '\n'), ctx, 'note') : '' });
      last = re.lastIndex;
    }
    html += fnRefs(esc(text.slice(last)));
    return { html, notes: notes.filter((n) => n.html) };
  }

  /* ---------- 학습지 렌더링 ---------- */
  function renderSheet(p) {
    const units = [];
    const C = (prefix) => ({ prefix, n: 0, units });
    const P = p.passage;
    const hasTrans = P.lines.some((l) => l.trans);
    const stageW = P.stageWidth || (hasTrans ? '37mm' : '42mm');
    const cols = hasTrans ? `minmax(0,1fr) ${stageW} ${P.transWidth || '37mm'}` : `minmax(0,1fr) ${stageW}`;
    const pStyle = `--cols:${cols};--gut:${P.gutter || '24mm'};--src-size:${P.textSize || 1.42}em`;

    const lineHtml = (ln, i) => {
      const ctx = C(`L${i + 1}-`);
      const { html, notes } = parseLine(ln.text, ctx);
      if (ln.under) notes.push({ k: 'u', align: 'under', at: ln.underAt || 0, html: blankable(ln.under, ctx, 'note') });
      const side = ln.side ? `<span class="side">${blankable(ln.side, ctx, 'note')}</span>` : '';
      const stage = ln.stage
        ? `<div class="stage"><span class="stage-tag">${esc(ln.stage.tag)}</span><span class="stage-v">${blankable(ln.stage.text, ctx, 'note')}</span></div>`
        : '';
      const trans = ln.trans ? unit(ctx, 'trans', rich(ln.trans, ctx, 'trans'), 'whole') : '';
      const cls = ['ln', ln.gapBefore ? 'gap' : '', ln.indent ? 'indent' : ''].join(' ');
      return `<div class="${cls}" data-li="${i + 1}">
        <div class="c-src"><div class="src"><span class="src-text">${html}</span>${side}</div>
          <div class="notes">${notes.map((n) => `<div class="nt" data-k="${n.k}" data-align="${n.align}" data-at="${n.at || 0}">${n.html}</div>`).join('')}</div></div>
        <div class="c-stage">${stage}</div>
        ${hasTrans ? `<div class="c-trans">${trans}</div>` : ''}
      </div>`;
    };

    // 여러 장: pageBreak가 있는 줄부터 다음 장. 괄호·필기·각주는 해당 줄이 있는 장에 붙는다.
    const pageOfLine = [];
    let pg = 0;
    P.lines.forEach((ln, i) => { if (i > 0 && ln.pageBreak) pg++; pageOfLine[i + 1] = pg; });
    const nPages = pg + 1;
    // 각주가 붙을 장: line(줄 번호)이 있으면 그 줄, 없으면 ^n이 처음 나오는 줄
    const fnPage = (f) => {
      if (f.line) return pageOfLine[f.line];
      const n = f.n;
      const i = P.lines.findIndex((ln) => new RegExp(`\\^${n}(?!\\d)`).test(ln.text));
      return i < 0 ? nPages - 1 : pageOfLine[i + 1];
    };

    const pageParts = Array.from({ length: nPages }, () => ({ lines: '', brackets: '', rightNotes: '', closing: '', fns: '' }));
    P.lines.forEach((ln, i) => { pageParts[pageOfLine[i + 1]].lines += lineHtml(ln, i); });
    (P.brackets || []).forEach((b, i) => {
      pageParts[pageOfLine[b.from]].brackets += `<div class="br-label" data-bi="${i}">${blankable(b.label, C(`B${i}-`), 'note')}</div>`;
    });
    (P.rightNotes || []).forEach((r, i) => {
      pageParts[pageOfLine[r.from]].rightNotes += `<div class="rn" data-ri="${i}">${blankable(r.text, C(`R${i}-`), 'note')}</div>`;
    });
    if (P.closing) {
      const ctx = C('CL-');
      pageParts[pageOfLine[P.closing.from]].closing = `<div class="closing">
        <div class="closing-main">${blankable(P.closing.text, ctx, 'note')}</div>
        ${P.closing.sub ? `<div class="closing-sub">${blankable(P.closing.sub, ctx, 'note')}</div>` : ''}
      </div>`;
    }
    (P.footnotes || []).forEach((f, i) => {
      pageParts[fnPage(f)].fns += `<div class="fn"><span class="fn-n">${f.n}</span><span><b>${esc(f.term)}</b> ${rich(f.text, C(`F${i}-`), 'note')}</span></div>`;
    });

    const cards = (p.summary || []).map((c, ci) => renderCard(c, C(`K${ci}-`))).join('');
    const where = [p.unit, p.lesson].filter(Boolean).map(esc).join(' · ');
    const colHead = `<div class="ln col-head"><div>${esc(P.textLabel || '본문')}</div><div>${esc(P.stageLabel || '시상 전개')}</div>${hasTrans ? `<div>${esc(P.transLabel || '현대어 풀이')}</div>` : ''}</div>`;

    const html = pageParts.map((pp, pi) => {
      const first = pi === 0, last = pi === nPages - 1;
      const head = first ? `<header class="sh-head">
        <div class="sh-top"><span class="sh-where">${where}</span><span class="sh-kind">문학 학습지</span></div>
        <div class="sh-title-row">
          <div class="sh-title-block">
            ${p.genre ? `<span class="chip">${esc(p.genre)}</span>` : ''}
            <h1 class="sh-title">${esc(p.title)}${p.hanja ? `<span class="hanja">${esc(p.hanja)}</span>` : ''}</h1>
            <div class="sh-by"><span class="sh-author">${esc(p.author || '')}</span>${p.source ? `<span class="sh-source">${esc(p.source)}</span>` : ''}</div>
          </div>
          <div class="sh-name"><div><span>학번</span><i></i></div><div><span>이름</span><i></i></div></div>
        </div>
      </header>` : `<header class="sh-head sh-cont">
        <div class="sh-top"><span class="sh-where">${esc(p.title)} — ${esc(p.author || '')}</span><span class="sh-kind">문학 학습지</span></div>
      </header>`;
      const passage = `<section class="sec sec-passage">
        <h2 class="sec-h"><span class="sec-n">Ⅰ</span>지문 읽기 · 필기${first ? '' : '<span class="sec-cont">(이어서)</span>'}${P.legend ? `<span class="sec-legend">${esc(P.legend)}</span>` : ''}</h2>
        <div class="passage" style="${pStyle}">
          ${colHead}
          <div class="passage-body">
            <svg class="br-svg" aria-hidden="true"></svg>
            ${pp.brackets}${pp.rightNotes}
            ${pp.lines}
            ${pp.closing}
          </div>
          ${pp.fns ? `<div class="fns">${pp.fns}</div>` : ''}
        </div>
      </section>`;
      const summary = last ? `

      <section class="sec sec-summary">
        <h2 class="sec-h"><span class="sec-n">Ⅱ</span>갈래 및 특성 정리</h2>
        <div class="summary">${cards}</div>
      </section>` : '';
      const pageNo = nPages > 1 ? `<span class="sh-page">${pi + 1} / ${nPages}</span>` : '';
      return `<div class="sheet" data-id="${esc(p.id)}"><div class="sheet-inner">
      ${head}

      ${passage}${summary}

      <footer class="sh-foot"><span>${esc(p.title)} — ${esc(p.author || '')}</span>${pageNo}<span>${where}</span></footer>
    </div></div>`;
    }).join('');

    return { html, units };
  }

  function renderCard(c, ctx) {
    const B = (v) => blankable(v, ctx, 'key');
    let body = '';
    if (c.type === 'table') {
      body = `<table class="kv">${c.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${B(v)}</td></tr>`).join('')}</table>`;
    } else if (c.type === 'stages') {
      body = `<div class="stages">${c.rows.map(([rng, tag, v]) =>
        `<div class="stg"><span class="stg-rng">${esc(rng)}</span><span class="stg-tag">${esc(tag)}</span><span class="stg-v">${B(v)}</span></div>`).join('')}</div>`;
    } else if (c.type === 'map') {
      body = `<table class="map">${c.rows.map(([k, v]) =>
        `<tr><th>${esc(k)}</th><td class="arr">→</td><td>${B(v)}</td></tr>`).join('')}</table>`;
    } else if (c.type === 'flow') {
      body = `<div class="flow">${c.steps.map((s) => `<div class="fl-step">${B(s)}</div>`).join('<div class="fl-arr"></div>')}</div>`;
    } else if (c.type === 'list') {
      body = `<ul class="list">${c.items.map((s) => `<li>${B(s)}</li>`).join('')}</ul>`;
    } else if (c.type === 'compare') {
      // head: ['', 'A', 'B'] / rows: [['항목', a, b]]
      body = `<table class="cmp"><thead><tr>${c.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${c.rows.map(([k, ...vs]) => `<tr><th>${esc(k)}</th>${vs.map((v) => `<td>${B(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else if (c.type === 'meter') {
      // rows: [['초장', '음보1', '음보2', ...]]
      body = `<table class="meter">${c.rows.map(([k, ...vs]) =>
        `<tr><th>${esc(k)}</th>${vs.map((v) => `<td>${B(v)}</td>`).join('')}</tr>`).join('')}</table>`;
    } else {
      body = `<p class="text">${B(c.text || '')}</p>`;
    }
    if (c.foot) body += `<p class="card-foot">${B(c.foot)}</p>`;
    const pos = [c.span && `grid-column: span ${c.span}`, c.rowSpan && `grid-row: span ${c.rowSpan}`].filter(Boolean).join(';');
    return `<div class="card card-${esc(c.type)}"${pos ? ` style="${pos}"` : ''}><h3>${esc(c.title)}</h3>${body}</div>`;
  }

  /* ---------- 필기 배치: 표시한 부분 바로 밑 ---------- */
  function layoutNotes(sheet) {
    const GAP = 6;
    $$('.ln[data-li]', sheet).forEach((ln) => {
      const cell = $('.c-src', ln);
      const box = $('.notes', ln);
      const nts = $$('.nt', box);
      if (!nts.length) { box.style.height = '0px'; return; }
      const cr = cell.getBoundingClientRect();
      const srcEm = parseFloat(getComputedStyle($('.src', ln)).fontSize);
      const items = nts.map((nt) => {
        nt.style.left = '0px';
        const w = nt.offsetWidth;
        let center;
        if (nt.dataset.align === 'under') {
          center = parseFloat(nt.dataset.at) * srcEm + w / 2;
        } else {
          const r = $(`.an[data-k="${nt.dataset.k}"]`, ln).getBoundingClientRect();
          center = nt.dataset.align === 'start' ? r.left - cr.left + w / 2 : (r.left + r.right) / 2 - cr.left;
        }
        return { nt, w, center };
      }).sort((a, b) => a.center - b.center);

      let prevRight = -Infinity;
      items.forEach((it) => {
        it.left = Math.max(it.center - it.w / 2, 0, prevRight + GAP);
        prevRight = it.left + it.w;
      });
      let nextLeft = Infinity;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const right = Math.min(it.left + it.w, cr.width, nextLeft - GAP);
        it.left = Math.max(0, right - it.w);
        nextLeft = it.left;
      }
      let h = 0;
      items.forEach((it) => { it.nt.style.left = it.left + 'px'; h = Math.max(h, it.nt.offsetHeight); });
      box.style.height = h + 'px';
    });
  }

  /* ---------- 줄 묶음 괄호 · 오른쪽 필기 · 낙구 화살표 ---------- */
  function layoutBrackets(sheet, p) {
    $$('.passage-body', sheet).forEach((body) => layoutBody(body, p));
  }
  function layoutBody(body, p) {
    const has = (li) => !!$(`.ln[data-li="${li}"]`, body);
    const svg = $('.br-svg', body);
    const B = body.getBoundingClientRect();
    const gut = parseFloat(getComputedStyle(body).paddingLeft);
    const x = gut - 10, tick = 7;
    const srcRect = (li) => $(`.ln[data-li="${li}"] .src`, body).getBoundingClientRect();
    const srcMid = (li) => { const r = srcRect(li); return r.top + r.height / 2 - B.top; };
    let d = '';
    (p.passage.brackets || []).forEach((b, i) => {
      if (!has(b.from)) return;
      const y1 = srcMid(b.from), y2 = srcMid(b.to);
      d += `M${x + tick},${y1}H${x}V${y2}H${x + tick}`;
      const lab = $(`.br-label[data-bi="${i}"]`, body);
      lab.style.width = (x - 6) + 'px';
      lab.style.top = ((y1 + y2) / 2 - lab.offsetHeight / 2) + 'px';
    });
    (p.passage.rightNotes || []).forEach((r, i) => {
      if (!has(r.from)) return;
      let right = 0;
      for (let li = r.from; li <= r.to; li++) {
        const t = $(`.ln[data-li="${li}"] .src`, body);
        const last = t.lastElementChild && t.lastElementChild.classList.contains('side') ? t.lastElementChild : $('.src-text', t);
        right = Math.max(right, last.getBoundingClientRect().right - B.left);
      }
      const el = $(`.rn[data-ri="${i}"]`, body);
      const y1 = srcMid(r.from), y2 = srcMid(r.to);
      el.style.left = (right + 8) + 'px';
      el.style.top = ((y1 + y2) / 2 - el.offsetHeight / 2) + 'px';
    });
    const cl = p.passage.closing && has(p.passage.closing.from) && $('.closing', body);
    let arrow = '';
    if (cl) {
      const y1 = srcRect(p.passage.closing.from).top - B.top - 2;
      const m = $('.closing-main', cl).getBoundingClientRect();
      const y2 = m.top + m.height / 2 - B.top;
      const x2 = m.left - B.left - 4;
      d += `M${x + tick},${y1}H${x}V${y2}H${x2}`;
      arrow = `<path d="M${x2 - 5},${y2 - 4}L${x2},${y2}L${x2 - 5},${y2 + 4}" fill="none"/>`;
    }
    svg.setAttribute('width', B.width);
    svg.setAttribute('height', B.height);
    svg.innerHTML = `<path d="${d}" fill="none"/>${arrow}`;
  }

  /* ---------- 한 장에 맞추기: 넘치면 줄이고, 남는 공간은 정리 카드가 채운다 ---------- */
  // 여러 장이면 모든 장을 같은 비율로 맞춘다.
  function fit(holder, p) {
    const sheets = $$('.sheet', holder);
    const overflows = () => sheets.some((sh) => { const inner = $('.sheet-inner', sh); return inner.scrollHeight > inner.clientHeight + 1; });
    sheets.forEach((sh) => sh.classList.add('fitting'));
    let s = 1;
    for (; s >= 0.76; s = +(s - 0.02).toFixed(2)) {
      sheets.forEach((sh) => sh.style.setProperty('--scale', s));
      layoutNotes(holder);
      layoutBrackets(holder, p);
      if (!overflows()) break;
    }
    const over = overflows();
    sheets.forEach((sh) => sh.classList.remove('fitting'));
    const warn = $('#fit-warn');
    if (warn) warn.hidden = !over;
    return s;
  }

  /* ---------- 앱 ---------- */
  const state = {
    p: null, units: [], blanks: new Set(),
    drags: [],            // 드래그로 만든 빈칸: { id, s, e } (학습지 전체 글자 위치)
    opts: Object.assign({ edit: true, numbers: true, answers: false }, store.get('wb:opts', {})),
    auto: store.get('wb:auto', DEFAULT_AUTO),
  };

  function saveBlanks() { store.set('wb:blanks:' + state.p.id, Array.from(state.blanks)); }
  function saveDrags() { store.set('wb:drags:' + state.p.id, state.drags); }

  /* ---------- 드래그 빈칸: 고른 글자 범위를 그대로 빈칸으로 ---------- */
  // 학습지 안 글자 위치(0부터)로 범위를 기억한다. 같은 지문이면 다시 그려도 위치가 같다.
  function textOffset(root, node, offset) {
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  }

  function wrapDrag(root, d) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    let pos = 0, n;
    while ((n = walker.nextNode())) {
      const len = n.data.length;
      const a = Math.max(d.s, pos), b = Math.min(d.e, pos + len);
      if (a < b) parts.push({ n, a: a - pos, b: b - pos });
      pos += len;
      if (pos >= d.e) break;
    }
    parts.forEach(({ n, a, b }) => {
      if (!n.data.slice(a, b).trim()) return;          // 칸 사이 공백은 감싸지 않는다
      let mid = n;
      if (a > 0) mid = mid.splitText(a);
      if (b - a < mid.data.length) mid.splitText(b - a);
      const span = document.createElement('span');
      span.className = 'bk drag';
      span.dataset.bid = d.id;
      mid.parentNode.insertBefore(span, mid);
      span.appendChild(mid);
    });
  }

  function addDragFromSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const inner = $('.sheet-holder');
    const range = sel.getRangeAt(0);
    if (!inner || !inner.contains(range.commonAncestorContainer)) return false;
    let s0 = textOffset(inner, range.startContainer, range.startOffset);
    let e0 = textOffset(inner, range.endContainer, range.endOffset);
    const text = inner.textContent;
    while (s0 < e0 && /\s/.test(text[s0])) s0++;      // 앞뒤 공백 제외
    while (e0 > s0 && /\s/.test(text[e0 - 1])) e0--;
    sel.removeAllRanges();
    if (e0 <= s0) return false;
    state.drags.push({ id: 'D' + Date.now().toString(36), s: s0, e: e0 });
    saveDrags();
    renderCurrent();
    return true;
  }
  function saveOpts() { store.set('wb:opts', state.opts); }

  function applyBlanks() {
    const holder = $('.sheet-holder');
    if (!$('.sheet', holder)) return;
    let no = 0;
    const seen = new Set();
    $$('.bk', holder).forEach((el) => {
      const bid = el.dataset.bid;
      const on = el.classList.contains('drag') || state.blanks.has(bid);
      el.classList.toggle('blank', on);
      delete el.dataset.no;
      if (on && !seen.has(bid)) { seen.add(bid); el.dataset.no = ++no; }  // 여러 조각이어도 번호는 하나
    });
    $$('.sheet', holder).forEach((sheet) => {
      sheet.classList.toggle('show-answers', state.opts.answers);
      sheet.classList.toggle('numbered', state.opts.numbers);
    });
    document.body.classList.toggle('editing', state.opts.edit);
    $('#blank-count').textContent = `빈칸 ${no}개`;
    relayout();
  }

  function relayout() {
    const holder = $('.sheet-holder');
    if ($('.sheet', holder) && state.p) fit(holder, state.p);
  }

  function openSheet(id) {
    const p = WB.passages[id];
    if (!p) { showGallery(); return; }
    state.p = p;
    const { html, units } = renderSheet(p);
    state.units = units;
    const ids = new Set(units.map((u) => u.id));
    state.blanks = new Set(store.get('wb:blanks:' + id, []).filter((b) => ids.has(b)));
    $('#gallery').hidden = true;
    $('#pdfmark').hidden = true;
    $('#viewer').hidden = false;
    $('#tb-sheet').hidden = false;
    $('#tb-title').textContent = p.title;
    document.title = `${p.title} — 국어 학습지`;
    state.drags = store.get('wb:drags:' + id, []);
    state.html = html;
    renderCurrent();
    syncToggles();
    document.fonts.ready.then(relayout);
  }

  function renderCurrent() {
    $('.sheet-holder').innerHTML = state.html;
    const holder = $('.sheet-holder');
    state.drags.forEach((d) => wrapDrag(holder, d));
    applyBlanks();
  }

  function showGallery() {
    state.p = null;
    $('#viewer').hidden = true;
    $('#pdfmark').hidden = true;
    $('#tb-sheet').hidden = true;
    $('#gallery').hidden = false;
    document.title = '국어 학습지';
    const list = Object.values(WB.passages).sort((a, b) => (a.order || 0) - (b.order || 0));
    $('#gallery-list').innerHTML = list.map((p) => `
      <a class="g-card" href="#/${esc(p.id)}">
        <span class="g-unit">${esc(p.unit || '')}</span>
        <span class="g-title">${esc(p.title)}${p.hanja ? `<small>(${esc(p.hanja)})</small>` : ''}</span>
        <span class="g-meta">${esc(p.author || '')}${p.genre ? ' · ' + esc(p.genre) : ''}</span>
      </a>`).join('') || '<p class="empty">등록된 지문이 없습니다.</p>';
  }

  function syncToggles() {
    $$('[data-opt]').forEach((b) => b.setAttribute('aria-pressed', !!state.opts[b.dataset.opt]));
  }

  function autoBlank() {
    const { cats, ratio } = state.auto;
    const pool = state.units.filter((u) => cats[u.cat]);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const n = Math.round(pool.length * ratio / 100);
    state.blanks = new Set(pool.slice(0, n).map((u) => u.id));
    saveBlanks();
    applyBlanks();
  }

  function setupAutoPanel() {
    const box = $('#auto-cats');
    box.innerHTML = Object.entries(CATS).map(([k, label]) =>
      `<label><input type="checkbox" data-cat="${k}" ${state.auto.cats[k] ? 'checked' : ''}> ${label}</label>`).join('');
    box.addEventListener('change', (e) => {
      const k = e.target.dataset.cat;
      if (k) { state.auto.cats[k] = e.target.checked; store.set('wb:auto', state.auto); }
    });
    const r = $('#auto-ratio'), out = $('#auto-ratio-out');
    r.value = state.auto.ratio; out.textContent = r.value + '%';
    r.addEventListener('input', () => {
      state.auto.ratio = +r.value; out.textContent = r.value + '%'; store.set('wb:auto', state.auto);
    });
    $('#auto-go').addEventListener('click', () => { autoBlank(); $('#auto-panel').hidden = true; });
  }

  function printAs(answers) {
    const prev = state.opts.answers;
    state.opts.answers = answers;
    applyBlanks();
    const restore = () => { state.opts.answers = prev; applyBlanks(); window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  function bind() {
    let dragged = false;
    document.addEventListener('mouseup', (e) => {
      dragged = state.opts.edit && !!e.target.closest('.sheet') && addDragFromSelection();
    });
    document.addEventListener('click', (e) => {
      if (dragged) { dragged = false; return; }       // 드래그 끝의 click은 무시
      const bk = state.opts.edit && e.target.closest('.sheet .bk');
      if (bk && bk.classList.contains('drag')) {
        state.drags = state.drags.filter((d) => d.id !== bk.dataset.bid);
        saveDrags();
        renderCurrent();
        return;
      }
      if (bk) {
        const id = bk.dataset.bid;
        state.blanks.has(id) ? state.blanks.delete(id) : state.blanks.add(id);
        saveBlanks();
        applyBlanks();
        return;
      }
      const opt = e.target.closest('[data-opt]');
      if (opt) {
        const k = opt.dataset.opt;
        state.opts[k] = !state.opts[k];
        saveOpts(); syncToggles(); applyBlanks();
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) {
        if (!e.target.closest('#auto-panel')) $('#auto-panel').hidden = true;
        return;
      }
      switch (act.dataset.act) {
        case 'auto': $('#auto-panel').hidden = !$('#auto-panel').hidden; break;
        case 'all': state.blanks = new Set(state.units.filter((u) => state.auto.cats[u.cat]).map((u) => u.id)); saveBlanks(); applyBlanks(); break;
        case 'clear': state.blanks.clear(); state.drags = []; saveBlanks(); saveDrags(); renderCurrent(); break;
        case 'print': printAs(false); break;
        case 'print-key': printAs(true); break;
      }
    });
    window.addEventListener('hashchange', route);
  }

  function route() {
    const id = decodeURIComponent((location.hash.match(/^#\/([^?]+)/) || [])[1] || '');
    if (id === 'pdf') showPdfMark();
    else if (id) openSheet(id);
    else showGallery();
  }

  function showPdfMark() {
    state.p = null;
    $('#viewer').hidden = true;
    $('#gallery').hidden = true;
    $('#tb-sheet').hidden = true;
    $('#pdfmark').hidden = false;
    document.title = 'PDF 표시하기 — 국어 학습지';
    WB.annotate.show();
  }

  function loadScript(src) {
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => { console.warn('불러오기 실패:', src); res(); };
      document.head.appendChild(s);
    });
  }

  WB.start = function () {
    bind();
    setupAutoPanel();
    Promise.all((WB.manifest || []).map((id) => loadScript(`data/passages/${id}.js`))).then(route);
  };
})();
