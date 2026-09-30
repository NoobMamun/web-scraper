(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const els = {
    home: $('#home'), results: $('#results'),
    form: $('#scrape-form'), url: $('#url'), scrapeBtn: $('#scrape-btn'), maxPages: $('#max-pages'),
    progress: $('#progress'), progressFill: $('#progress-fill'), progressText: $('#progress-text'),
    error: $('#error'),
    favicon: $('#site-favicon'), siteTitle: $('#site-title'), siteUrl: $('#site-url'),
    stats: $('#stats'), notes: $('#notes'),
    categories: $('#categories'), categoryList: $('#category-list'),
    search: $('#search'), chips: $('#section-chips'), sections: $('#sections'), empty: $('#empty'),
    exportBtn: $('#export-btn'), exportMenu: $('#export-menu'), newBtn: $('#new-btn'),
    toast: $('#toast'), sectionTpl: $('#section-tpl'),
  };

  const PAGE_SIZE = 10;
  const state = { data: null, query: '', section: 'all', expanded: new Set() };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlight = (text, q) => (q ? esc(text).replace(new RegExp(`(${escRe(esc(q))})`, 'gi'), '<mark>$1</mark>') : esc(text));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const safeHref = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
  }

  // ---------- scraping ----------
  function setLoading(on) {
    els.scrapeBtn.disabled = on;
    els.url.readOnly = on;
    els.scrapeBtn.textContent = on ? 'Scraping…' : 'Scrape Website';
    els.progress.hidden = !on;
    if (on) setProgress('Starting…', 2);
  }

  function setProgress(message, percent) {
    els.progressText.textContent = message;
    els.progressFill.style.width = `${Math.max(2, Math.min(100, percent || 0))}%`;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  async function scrape(url) {
    els.error.hidden = true;
    setLoading(true);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages: Number(els.maxPages.value) }),
      });
      if (!res.ok || !res.body) throw new Error(`Server error (${res.status}).`);

      // The server streams newline-delimited JSON: progress events, then result or error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let outcome = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === 'progress') setProgress(msg.message, msg.percent);
          else outcome = msg;
        }
      }
      if (!outcome) throw new Error('The connection closed before scraping finished.');
      if (outcome.type === 'error') throw new Error(outcome.message);
      setProgress('Done', 100);
      showResults(outcome.data);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Could not reach the scraper server. Is it running?' : err.message);
    } finally {
      setLoading(false);
    }
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = els.url.value.trim();
    if (!url) {
      showError('Please enter a website URL, e.g. https://example.com');
      els.url.focus();
      return;
    }
    scrape(url);
  });

  // ---------- results ----------
  function showResults(data) {
    state.data = data;
    state.query = '';
    state.section = 'all';
    state.expanded.clear();
    els.search.value = '';

    const { site } = data;
    els.siteTitle.textContent = site.title;
    els.siteUrl.textContent = site.finalUrl;
    els.siteUrl.href = safeHref(site.finalUrl);
    els.favicon.hidden = !site.favicon;
    if (site.favicon) {
      els.favicon.src = site.favicon;
      els.favicon.onerror = () => { els.favicon.hidden = true; };
    }

    const pages = data.pagesScanned === 1 ? '1 page' : `${data.pagesScanned} pages`;
    els.stats.textContent = `${data.stats.sections} sections · ${data.stats.items} items · ${pages} scanned · ${new Date(data.scrapedAt).toLocaleString()}`;
    els.notes.innerHTML = data.notes.map((n) => `<li>${esc(n)}</li>`).join('');

    els.categories.hidden = !site.categories.length;
    els.categoryList.innerHTML = site.categories
      .map((c) => `<a class="chip" href="${esc(safeHref(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>`)
      .join('');

    els.home.hidden = true;
    els.results.hidden = false;
    window.scrollTo(0, 0);
    render();
  }

  function matches(item, q) {
    if (!q) return true;
    const hay = `${item.title} ${item.description} ${item.author} ${item.date} ${item.url}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  /** Current view: sections and items after search + section filter. Also what gets exported. */
  function visibleData() {
    const q = state.query.trim();
    const sections = state.data.sections
      .filter((s) => state.section === 'all' || s.id === state.section)
      .map((s) => ({ ...s, items: s.items.filter((it) => matches(it, q)) }))
      .filter((s) => s.items.length);
    return { ...state.data, sections };
  }

  function renderChips() {
    const q = state.query.trim();
    const all = state.data.sections.map((s) => ({ s, n: s.items.filter((it) => matches(it, q)).length }));
    const total = all.reduce((n, x) => n + x.n, 0);
    const chip = (id, label, n) =>
      `<button class="chip" role="tab" data-id="${esc(id)}" aria-selected="${state.section === id}">${esc(label)}<span class="n">${n}</span></button>`;
    els.chips.innerHTML = chip('all', 'All', total) + all.map(({ s, n }) => chip(s.id, s.name, n)).join('');
  }

  function renderItem(item, q) {
    const href = safeHref(item.url);
    const img = safeHref(item.image);
    const title = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${highlight(item.title || item.url, q)}</a>`
      : highlight(item.title || '(untitled)', q);
    const meta = [
      item.date && `<span title="Date">📅 ${highlight(item.date, q)}</span>`,
      item.author && `<span title="Author">✍️ ${highlight(item.author, q)}</span>`,
      href && `<a class="url" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(href))}${esc(new URL(href).pathname.length > 1 ? new URL(href).pathname : '')}</a>`,
    ].filter(Boolean).join('');
    const full = item.content
      ? `<button class="btn subtle full" data-toggle-full>Show full text</button><div class="full-text" hidden>${esc(item.content.replace(/^## /gm, ''))}</div>`
      : '';
    return `<li class="item">
      ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <div class="body">
        <h3>${title}</h3>
        ${item.description ? `<p class="desc">${highlight(item.description, q)}</p>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        ${full}
      </div>
    </li>`;
  }

  function render() {
    renderChips();
    const q = state.query.trim();
    const view = visibleData();
    els.sections.innerHTML = '';
    for (const s of view.sections) {
      const node = els.sectionTpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = s.id;
      node.querySelector('h2').innerHTML = highlight(s.name, '');
      node.querySelector('.count').textContent = `${s.items.length} item${s.items.length === 1 ? '' : 's'}`;
      const showAll = state.expanded.has(s.id) || q;
      const items = showAll ? s.items : s.items.slice(0, PAGE_SIZE);
      node.querySelector('.items').innerHTML = items.map((it) => renderItem(it, q)).join('');
      const more = node.querySelector('.show-more');
      if (!showAll && s.items.length > PAGE_SIZE) {
        more.hidden = false;
        more.textContent = `Show all ${s.items.length} items`;
      }
      els.sections.appendChild(node);
    }
    els.empty.hidden = view.sections.length > 0;
    const filtered = q || state.section !== 'all';
    els.exportBtn.firstChild.textContent = filtered ? 'Export filtered ' : 'Export ';
  }

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = els.search.value; render(); }, 120);
  });

  els.chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.section = btn.dataset.id === state.section ? 'all' : btn.dataset.id;
    render();
  });

  els.sections.addEventListener('click', (e) => {
    const head = e.target.closest('.section-head');
    if (head) {
      head.setAttribute('aria-expanded', head.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
      return;
    }
    const more = e.target.closest('.show-more');
    if (more) {
      state.expanded.add(more.closest('.section').dataset.id);
      render();
      return;
    }
    const toggle = e.target.closest('[data-toggle-full]');
    if (toggle) {
      const box = toggle.nextElementSibling;
      box.hidden = !box.hidden;
      toggle.textContent = box.hidden ? 'Show full text' : 'Hide full text';
    }
  });

  els.newBtn.addEventListener('click', () => {
    els.results.hidden = true;
    els.home.hidden = false;
    els.error.hidden = true;
    els.url.select();
    els.url.focus();
  });

  // ---------- export ----------
  function closeMenu() {
    els.exportMenu.hidden = true;
    els.exportBtn.setAttribute('aria-expanded', 'false');
  }

  els.exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = els.exportMenu.hidden;
    els.exportMenu.hidden = !open;
    els.exportBtn.setAttribute('aria-expanded', String(open));
    if (open) els.exportMenu.querySelector('button').focus();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.export')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  els.exportMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-format]');
    if (!btn) return;
    closeMenu();
    const format = btn.dataset.format;
    const data = visibleData();
    if (!data.sections.length) return toast('Nothing to export — clear the search first.');
    els.exportBtn.disabled = true;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, data }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Export failed.');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `export.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast(`Downloaded ${name}`);
    } catch (err) {
      toast(err.message);
    } finally {
      els.exportBtn.disabled = false;
    }
  });
})();
