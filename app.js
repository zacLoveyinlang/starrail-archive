/* 星穹全典 — static, data-driven PWA.
 * No framework, no build step, no remote API at runtime.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const DATA_ROOT = 'data/';
  const FAV_KEY = 'starrail-codex:favorites';
  const INSTALL_DISMISSED_KEY = 'starrail-codex:install-dismissed';

  const ELEMENTS = {
    physical: '物理', fire: '火', ice: '冰', lightning: '雷',
    wind: '风', quantum: '量子', imaginary: '虚数', unknown: '未知'
  };
  const PATHS = {
    Destruction: '毁灭', Hunt: '巡猎', Erudition: '智识', Harmony: '同谐',
    Nihility: '虚无', Preservation: '存护', Abundance: '丰饶', Remembrance: '记忆', Elation: '欢愉', Unknown: '未知'
  };
  const ELEMENT_ALIASES = {
    '物理': 'physical', '火': 'fire', '冰': 'ice', '雷': 'lightning', '风': 'wind',
    '量子': 'quantum', '虚数': 'imaginary', '雷属性': 'lightning', '火属性': 'fire',
    '冰属性': 'ice', '物理属性': 'physical', '风属性': 'wind', '量子属性': 'quantum', '虚数属性': 'imaginary'
  };
  const PATH_ALIASES = {
    '毁灭': 'Destruction', '巡猎': 'Hunt', '智识': 'Erudition', '同谐': 'Harmony',
    '虚无': 'Nihility', '存护': 'Preservation', '丰饶': 'Abundance', '记忆': 'Remembrance', '欢愉': 'Elation',
    'memory': 'Remembrance', 'remembrance': 'Remembrance', 'thehunt': 'Hunt', 'hunt': 'Hunt',
    'erudition': 'Erudition', 'harmony': 'Harmony', 'nihility': 'Nihility',
    'preservation': 'Preservation', 'abundance': 'Abundance', 'elation': 'Elation', 'destruction': 'Destruction'
  };
  const ELEMENT_COLOR = {
    physical: '#d6d8df', fire: '#ff8d6a', ice: '#7fd9f2', lightning: '#bd8cff',
    wind: '#73dfb2', quantum: '#8a9dff', imaginary: '#f2d26d', unknown: '#9aa7bb'
  };
  const SKILL_ORDER = { '普攻': 1, '战技': 2, '终结技': 3, '天赋': 4, '秘技': 5, '额外能力': 6, '属性加成': 7, '欢愉技': 8, '星神权能': 9 };
  const TYPE_ORDER = { '开拓任务': 1, '同行任务': 2, '冒险任务': 3, '活动任务': 4, '系列任务': 5, '终末任务': 6, '日常任务': 7, '玩法任务': 8 };

  const S = {
    meta: null,
    characters: [],
    stories: [],
    charDetails: new Map(),
    storyDetails: new Map(),
    charLoading: new Map(),
    storyLoading: new Map(),
    favorites: new Set(readJSON(localStorage.getItem(FAV_KEY), [])),
    charFilters: { q: '', element: 'all', path: 'all', rarity: 'all', playable: true, sort: 'name' },
    storyFilters: { q: '', type: 'all', limit: 36 },
    charTab: 'overview',
    searchMode: 'entries',
    searchIndex: null,
    searchLoading: false,
    storyFocus: null,
    routeToken: 0,
    activeStory: null,
    installPrompt: null,
  };

  function readJSON(text, fallback) {
    try { return JSON.parse(text) ?? fallback; } catch { return fallback; }
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function escAttr(value) { return esc(value).replace(/`/g, '&#96;'); }
  function nl2br(value) { return esc(value).replace(/\n/g, '<br>'); }
  function num(value) { return Number(value || 0).toLocaleString('zh-CN'); }
  function versionNum(v) { const n = parseFloat(String(v || '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : -1; }
  function elementKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'unknown';
    const lower = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (ELEMENTS[lower]) return lower;
    if (ELEMENT_ALIASES[raw]) return ELEMENT_ALIASES[raw];
    if (ELEMENT_ALIASES[lower]) return ELEMENT_ALIASES[lower];
    return lower || 'unknown';
  }
  function elementLabel(value) { return ELEMENTS[elementKey(value)] || value || '未知'; }
  function pathKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Unknown';
    if (PATHS[raw]) return raw;
    if (PATH_ALIASES[raw]) return PATH_ALIASES[raw];
    const lower = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (PATH_ALIASES[lower]) return PATH_ALIASES[lower];
    return raw;
  }
  function pathLabel(value) { return PATHS[pathKey(value)] || value || '未知'; }
  function typeLabel(type) { return String(type || '未分类').replace(/\s*<!--[\s\S]*?-->/g, '').trim(); }
  function cleanText(value) { return String(value || '').replace(/\s*<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim(); }
  function isNoise(value) { return !cleanText(value).replace(/[-—–_=·\s]/g, ''); }

  async function fetchJSON(path) {
    const res = await fetch(DATA_ROOT + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return res.json();
  }

  function loadChar(id) {
    if (S.charDetails.has(id)) return Promise.resolve(S.charDetails.get(id));
    if (S.charLoading.has(id)) return S.charLoading.get(id);
    const p = fetchJSON(`characters/${id}.json`).then(data => {
      S.charDetails.set(id, data);
      S.charLoading.delete(id);
      return data;
    }).catch(err => { S.charLoading.delete(id); throw err; });
    S.charLoading.set(id, p);
    return p;
  }
  function loadStory(id) {
    if (S.storyDetails.has(id)) return Promise.resolve(S.storyDetails.get(id));
    if (S.storyLoading.has(id)) return S.storyLoading.get(id);
    const p = fetchJSON(`stories/${id}.json`).then(data => {
      S.storyDetails.set(id, data);
      S.storyLoading.delete(id);
      return data;
    }).catch(err => { S.storyLoading.delete(id); throw err; });
    S.storyLoading.set(id, p);
    return p;
  }

  function setHTML(html) {
    const app = $('#app');
    app.innerHTML = html;
    app.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showToast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 260);
    }, 1800);
  }
  function toggleFavorite(id) {
    if (S.favorites.has(id)) { S.favorites.delete(id); showToast('已取消收藏'); }
    else { S.favorites.add(id); showToast('已加入收藏'); }
    localStorage.setItem(FAV_KEY, JSON.stringify([...S.favorites]));
    $$('.fav-btn').forEach(btn => {
      if (btn.dataset.fav === id) {
        btn.classList.toggle('active', S.favorites.has(id));
        btn.setAttribute('aria-label', S.favorites.has(id) ? '取消收藏' : '收藏');
        btn.title = S.favorites.has(id) ? '取消收藏' : '收藏';
      }
    });
  }

  function setActiveNav(name) {
    $$('.desktop-nav a, .mobile-nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  }
  function charFor(id) { return S.characters.find(c => c.id === id); }
  function storyFor(id) { return S.stories.find(s => s.id === id); }
  function charById(id) { return charFor(id); }

  // ---------- boot ----------
  async function boot() {
    try {
      const [meta, charIndex, storyIndex] = await Promise.all([
        fetchJSON('meta.json'), fetchJSON('characters/index.json'), fetchJSON('stories/index.json')
      ]);
      S.meta = meta;
      S.characters = charIndex.characters || [];
      S.stories = (storyIndex.stories || []).map(s => ({ ...s, type: typeLabel(s.type) }));
      registerSW();
      bindGlobalUI();
      route();
    } catch (err) {
      console.error(err);
      setHTML(`<div class="empty-state"><h2>档案未能载入</h2><p>请通过本地 HTTP 服务或 GitHub Pages 打开本项目，直接双击 HTML 会因浏览器安全策略无法读取 JSON 数据。</p><code>python3 -m http.server 8080</code></div>`);
    }
  }

  // ---------- routing ----------
  function route() {
    const token = ++S.routeToken;
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    const parts = hash.split('/').filter(Boolean);
    const head = parts[0] || 'home';
    if (head === 'character') { setActiveNav('characters'); openCharacter(parts[1], token); return; }
    if (head === 'story') { setActiveNav('stories'); openStory(parts[1], token); return; }
    if (head === 'characters') { setActiveNav('characters'); renderCharacters(); return; }
    if (head === 'stories') { setActiveNav('stories'); renderStories(); return; }
    if (head === 'about') { setActiveNav('about'); renderAbout(); return; }
    setActiveNav('home');
    renderHome();
  }

  // ---------- home ----------
  function renderHome() {
    const counts = S.meta.counts;
    const recent = S.characters
      .filter(c => c.playable)
      .sort((a, b) => versionNum(b.version) - versionNum(a.version) || (b.id > a.id ? 1 : -1))
      .slice(0, 9);
    const pathCounts = S.stories.reduce((acc, s) => {
      const t = typeLabel(s.type) || '其他';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    const pathRows = Object.entries(pathCounts)
      .sort((a, b) => (TYPE_ORDER[a[0]] || 99) - (TYPE_ORDER[b[0]] || 99))
      .slice(0, 6)
      .map(([type, count]) => `
        <a class="story-path" href="#/stories" data-story-type="${escAttr(type)}">
          <div><b>${esc(type)}</b><span>${type === '开拓任务' ? '主线航路' : '支线与活动记录'}</span></div>
          <span class="count">${num(count)}</span>
        </a>`).join('');

    setHTML(`
      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow">Star Rail Codex · 非官方玩家档案</div>
          <h1>把每一条<em>命途</em><br>收进同一座档案库。</h1>
          <p class="hero-lead">角色、行迹、数值、星魂、语音与剧情台词，全部拆成可检索、可离线缓存的独立数据卷。不是一张巨型网页，而是一座能持续扩容的星图。</p>
          <div class="hero-meta">
            <span class="chip gold">米游社官方平台数据</span>
            <span class="chip">BWIKI 剧情补全</span>
            <span class="chip cyan">本地优先 · 无需登录</span>
          </div>
          <div class="hero-actions">
            <a class="btn primary" href="#/characters">打开角色图鉴 <span aria-hidden="true">→</span></a>
            <a class="btn" href="#/stories">进入剧情卷宗</a>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><b>${num(counts.characters)}</b><span>角色档案</span></div>
            <div class="hero-stat"><b>${num(counts.stories)}</b><span>剧情任务</span></div>
            <div class="hero-stat"><b>${num(counts.storyLines)}</b><span>检索台词</span></div>
            <div class="hero-stat"><b>${num(counts.voices)}</b><span>语音记录</span></div>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="orbit"></div><div class="orbit"></div><div class="orbit"></div>
          <div class="hero-core"><span class="hero-glyph">✦</span></div>
          <span class="hero-caption">MAY THIS JOURNEY REACH THE STARS</span>
        </div>
      </section>
      <div class="notice-bar"><strong>阅读提示：</strong>米游社提供官方平台支持的图鉴资料；BWIKI 为社区共建，剧情页与部分补全字段会保留来源链接。所有角色与剧情版权归米哈游及原权利人所有。</div>

      <section class="section">
        <div class="section-head"><div><div class="eyebrow">Recently indexed</div><h2>最近实装</h2></div><p>按实装版本排序的角色切片</p><a class="section-link" href="#/characters">全部角色 →</a></div>
        <div class="recent-strip">
          ${recent.map((c, i) => `
            <a class="recent-card element-${elementKey(c.element)}" href="#/character/${escAttr(c.id)}">
              <span class="corner-index">${String(i + 1).padStart(2, '0')} / ${esc(c.version || '—')}</span>
              ${c.figure ? `<img src="${escAttr(c.figure)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
              <div class="recent-card-body">
                <h3>${esc(c.name)}</h3>
                <p>${esc(pathLabel(c.path))} · ${esc(elementLabel(c.element))} · ${'★'.repeat(Number(c.rarity) || 0)}</p>
                <div class="chips"><span class="chip">${num(c.skillCount)} 技能</span><span class="chip">${num(c.voiceCount)} 语音</span></div>
              </div>
            </a>`).join('')}
        </div>
      </section>

      <section class="section module-grid">
        <div>
          <div class="section-head"><div><div class="eyebrow">Story archive</div><h2>剧情卷宗</h2></div><a class="section-link" href="#/stories">全部任务 →</a></div>
          <div class="story-paths">${pathRows || '<div class="empty-state">暂无剧情索引</div>'}</div>
        </div>
        <div>
          <div class="section-head"><div><div class="eyebrow">Archive map</div><h2>档案构成</h2></div></div>
          <div class="panel info-card">
            <div class="info-row"><span class="faint">官方平台角色</span><b>${num(counts.officialPlatformCharacters)}</b></div>
            <div class="info-row"><span class="faint">社区补全角色</span><b>${num(counts.communityOnlyCharacters)}</b></div>
            <div class="info-row"><span class="faint">技能 / 行迹 / 星魂</span><b>${num(counts.skills)}</b></div>
            <div class="info-row"><span class="faint">立绘与头像</span><b>${num(counts.artworks)}</b></div>
            <div class="info-row"><span class="faint">生成时间</span><b>${esc((S.meta.generatedAt || '').slice(0, 10))}</b></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><div><div class="eyebrow">Provenance</div><h2>数据来源</h2></div></div>
        <div class="source-grid">
          <article class="panel source-card"><h3>米游社 · 开拓者笔记</h3><p>角色基础资料、行迹技能、等级属性、星魂、官方语音与画廊。以角色详情 API 的结构化字段为主。</p><a href="https://bbs.mihoyo.com/sr/wiki/" target="_blank" rel="noopener">打开来源站 ↗</a></article>
          <article class="panel source-card"><h3>哔哩哔哩 BWIKI</h3><p>社区共建的角色补全、任务正文、选项分支与立绘文件索引。剧情文本按任务页逐卷归档。</p><a href="https://wiki.biligame.com/sr/" target="_blank" rel="noopener">打开来源站 ↗</a></article>
        </div>
      </section>
    `);
    $$('[data-story-type]').forEach(a => a.addEventListener('click', e => {
      S.storyFilters.type = a.dataset.storyType;
      S.storyFilters.q = '';
      S.storyFilters.limit = 36;
    }));
  }

  // ---------- character collection ----------
  function renderCharacters() {
    setHTML(`
      <div class="collection-head">
        <div><div class="eyebrow">Character archive</div><h1>角色图鉴</h1><p>形态、命途、数值与声音，一次归档。</p></div>
        <span class="count" id="character-count"></span>
      </div>
      <div class="filter-bar">
        <label class="filter-search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg><input id="character-search" type="search" placeholder="搜索角色、阵营或版本…" value="${escAttr(S.charFilters.q)}"></label>
        <div class="filter-group" id="element-filters"></div>
        <div class="filter-group">
          <span class="filter-label">命途</span>
          <select class="filter-select" id="path-filter">
            <option value="all">全部</option>
            ${Object.entries(PATHS).filter(([k]) => k !== 'Unknown').map(([k, v]) => `<option value="${escAttr(k)}" ${S.charFilters.path === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group">
          <span class="filter-label">星级</span>
          ${[['all','全部'],['5','五星'],['4','四星']].map(([v,l]) => `<button class="filter-chip ${S.charFilters.rarity === v ? 'active' : ''}" data-rarity="${v}">${l}</button>`).join('')}
        </div>
        <button class="filter-chip ${S.charFilters.playable ? 'active' : ''}" id="playable-filter">仅可玩角色</button>
        <div class="filter-group">
          <span class="filter-label">排序</span>
          <select class="filter-select" id="sort-filter">
            <option value="name" ${S.charFilters.sort === 'name' ? 'selected' : ''}>名称</option>
            <option value="version" ${S.charFilters.sort === 'version' ? 'selected' : ''}>实装版本</option>
            <option value="rarity" ${S.charFilters.sort === 'rarity' ? 'selected' : ''}>星级</option>
          </select>
        </div>
        <button class="filter-clear" id="clear-character-filters">清除</button>
      </div>
      <div class="character-grid" id="character-grid"></div>
    `);

    const elements = [['all','全部'], ...Object.entries(ELEMENTS).filter(([k]) => k !== 'unknown').map(([k,v]) => [k,v])];
    $('#element-filters').innerHTML = `<span class="filter-label">属性</span>` + elements.map(([v,l]) => `<button class="filter-chip ${S.charFilters.element === v ? 'active' : ''}" data-element="${v}">${l}</button>`).join('');
    $('#character-search').addEventListener('input', e => { S.charFilters.q = e.target.value; renderCharacterCards(); });
    $$('#element-filters [data-element]').forEach(btn => btn.addEventListener('click', () => { S.charFilters.element = btn.dataset.element; renderCharacters(); }));
    $$('[data-rarity]').forEach(btn => btn.addEventListener('click', () => { S.charFilters.rarity = btn.dataset.rarity; renderCharacters(); }));
    $('#path-filter').addEventListener('change', e => { S.charFilters.path = e.target.value; renderCharacters(); });
    $('#sort-filter').addEventListener('change', e => { S.charFilters.sort = e.target.value; renderCharacters(); });
    $('#playable-filter').addEventListener('click', () => { S.charFilters.playable = !S.charFilters.playable; renderCharacters(); });
    $('#clear-character-filters').addEventListener('click', () => {
      S.charFilters = { q: '', element: 'all', path: 'all', rarity: 'all', playable: true, sort: 'name' };
      renderCharacters();
    });
    renderCharacterCards();
  }

  function matchesChar(c) {
    const f = S.charFilters;
    if (f.playable && !c.playable) return false;
    if (f.element !== 'all' && elementKey(c.element) !== f.element) return false;
    if (f.path !== 'all' && pathKey(c.path) !== f.path) return false;
    if (f.rarity !== 'all' && String(c.rarity) !== f.rarity) return false;
    if (f.q) {
      const q = f.q.trim().toLowerCase();
      const hay = [c.name, c.summary, c.faction, c.version, pathLabel(c.path), elementLabel(c.element)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderCharacterCards() {
    const grid = $('#character-grid');
    if (!grid) return;
    let list = S.characters.filter(matchesChar);
    if (S.charFilters.sort === 'version') list.sort((a, b) => versionNum(b.version) - versionNum(a.version) || a.name.localeCompare(b.name, 'zh'));
    else if (S.charFilters.sort === 'rarity') list.sort((a, b) => Number(b.rarity) - Number(a.rarity) || a.name.localeCompare(b.name, 'zh'));
    else list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    $('#character-count').textContent = `${num(list.length)} / ${num(S.characters.filter(c => !S.charFilters.playable || c.playable).length)} 位角色`;
    if (!list.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">没有符合当前筛选条件的角色。</div>'; return; }
    grid.innerHTML = list.map(c => {
      const icon = c.icon ? `<img class="char-icon" src="${escAttr(c.icon)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="char-icon" aria-hidden="true"></span>`;
      const art = c.figure || c.icon;
      const isFav = S.favorites.has(c.id);
      return `<div class="char-card element-${elementKey(c.element)}" data-char="${escAttr(c.id)}" role="link" tabindex="0" aria-label="查看 ${escAttr(c.name)}">
        ${art ? `<img class="char-card-art" src="${escAttr(art)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="char-card-top">${icon}<span class="rarity">${'★'.repeat(Number(c.rarity) || 0)}</span></div>
        <div class="char-card-body">
          <h3>${esc(c.name)}</h3>
          <div class="sub"><span class="element-dot"></span>${esc(elementLabel(c.element))} · ${esc(pathLabel(c.path))}${c.playable ? '' : ' · <span class="npc-flag">资料角色</span>'}</div>
          <div class="chips"><span class="chip">${esc(c.version || '—')}</span><span class="chip">${num(c.voiceCount)} 语音</span></div>
        </div>
        <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${escAttr(c.id)}" aria-label="${isFav ? '取消收藏' : '收藏'}" title="${isFav ? '取消收藏' : '收藏'}">✦</button>
      </div>`;
    }).join('');
    $$('#character-grid [data-char]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('[data-fav]')) return;
        location.hash = `#/character/${card.dataset.char}`;
      });
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = `#/character/${card.dataset.char}`; } });
    });
    $$('#character-grid [data-fav]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(btn.dataset.fav); }));
  }

  // ---------- character detail ----------
  async function openCharacter(id, token) {
    if (!id) { location.hash = '#/characters'; return; }
    setHTML(`<div class="boot-screen"><div class="boot-star"></div><p>正在读取角色档案…</p></div>`);
    let char;
    try { char = await loadChar(id); }
    catch (err) { setHTML(`<div class="empty-state">角色档案读取失败：${esc(err.message)}</div>`); return; }
    if (token !== S.routeToken) return;
    S.charTab = 'overview';
    document.title = `${char.name} · 星穹全典`;
    const el = elementKey(char.element);
    const icon = char.icon ? `<img class="detail-icon" src="${escAttr(char.icon)}" alt="">` : '';
    const figure = char.figure || '';
    const subt = [char.officialName && char.officialName !== char.name ? char.officialName : '', pathLabel(char.path), elementLabel(char.element), char.rarity ? `${'★'.repeat(Number(char.rarity))}` : ''].filter(Boolean).join(' · ');
    const infoVersion = char.info?.['实装版本'] || char.wiki?.fields?.['实装版本'] || '';
    const infoTime = char.info?.['上线时间'] || char.info?.['实装日期'] || char.wiki?.fields?.['实装日期'] || '';
    const faction = char.info?.['阵营'] || char.info?.['派系'] || char.wiki?.fields?.['阵营'] || '';
    const isFav = S.favorites.has(char.id);

    setHTML(`
      <section class="detail-hero element-${el}">
        ${figure ? `<img class="detail-hero-art" src="${escAttr(figure)}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="detail-copy">
          <a class="breadcrumb" href="#/characters">← 返回角色图鉴</a>
          <div class="detail-title-row">${icon}<h1>${esc(char.name)}</h1></div>
          <p class="detail-sub">${esc(subt)}</p>
          <p class="detail-summary">${esc(cleanText(char.summary || char.storyShort || ''))}</p>
          <div class="detail-meta">
            ${faction ? `<span class="chip">${esc(faction)}</span>` : ''}
            ${infoVersion ? `<span class="chip gold">版本 ${esc(infoVersion)}</span>` : ''}
            ${infoTime ? `<span class="chip">${esc(infoTime)}</span>` : ''}
            ${char.playable ? '' : '<span class="chip">资料角色 · 非可玩单位</span>'}
          </div>
          <div class="detail-actions">
            <button class="btn ${isFav ? 'primary' : ''}" id="detail-fav">${isFav ? '✦ 已收藏' : '✦ 收藏档案'}</button>
            ${char.sources?.[0]?.url ? `<a class="btn" href="${escAttr(char.sources[0].url)}" target="_blank" rel="noopener">查看原始词条 ↗</a>` : ''}
          </div>
        </div>
      </section>
      <nav class="detail-nav" id="detail-tabs" aria-label="角色档案分区">
        ${[['overview','概览'],['skills','技能与行迹'],['eidolons','星魂'],['stories','角色故事'],['voices','语音'],['gallery','立绘画廊'],['sources','来源']].map(([k,l]) => `<button data-tab="${k}" class="${k === 'overview' ? 'active' : ''}">${l}</button>`).join('')}
      </nav>
      <div id="detail-panel"></div>
    `);
    $('#detail-fav').addEventListener('click', () => {
      toggleFavorite(char.id);
      const btn = $('#detail-fav');
      btn.classList.toggle('primary', S.favorites.has(char.id));
      btn.textContent = S.favorites.has(char.id) ? '✦ 已收藏' : '✦ 收藏档案';
    });
    $$('#detail-tabs button').forEach(btn => btn.addEventListener('click', () => {
      S.charTab = btn.dataset.tab;
      $$('#detail-tabs button').forEach(b => b.classList.toggle('active', b === btn));
      renderCharTab(char);
    }));
    renderCharTab(char);
  }

  function renderCharTab(char) {
    const panel = $('#detail-panel');
    if (!panel) return;
    panel.innerHTML = ({ overview: charOverview, skills: charSkills, eidolons: charEidolons, stories: charStories, voices: charVoices, gallery: charGallery, sources: charSources })[S.charTab](char);
    if (S.charTab === 'stories') {
      const first = panel.querySelector('details');
      if (first) first.open = true;
    }
    if (S.charTab === 'voices') bindVoiceTab(char);
    if (S.charTab === 'gallery') bindGallery();
  }

  function charOverview(char) {
    const info = char.info || {};
    const rows = Object.entries(info).filter(([, v]) => v && String(v).trim()).map(([k, v]) => `<div class="info-row"><dt>${esc(k)}</dt><dd>${esc(cleanText(v))}</dd></div>`).join('');
    const l1 = char.stats?.level1 || {};
    const l80 = char.stats?.level80 || {};
    const statKeys = [...new Set([...Object.keys(l1), ...Object.keys(l80)])];
    const statRows = statKeys.length ? `
      <table class="stat-table"><thead><tr><th>属性</th><th>1级</th><th>80级</th></tr></thead><tbody>
      ${statKeys.map(k => `<tr><td>${esc(k)}</td><td>${esc(l1[k] || '—')}</td><td>${esc(cleanText(l80[k] || '—'))}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">该词条没有结构化等级属性。</p>';
    const traits = [];
    for (let i = 1; i <= 3; i++) {
      const name = char.skills?.find(s => s.type === '额外能力' && s.name)?.name;
      if (name && !traits.includes(name)) traits.push(name);
    }
    return `<div class="detail-grid">
      <div class="span-5 panel info-card"><h3>基本档案</h3><div class="info-list">${rows || '<p class="muted">暂无补充信息。</p>'}</div></div>
      <div class="span-7 panel info-card"><h3>等级属性</h3>${statRows}
        ${l80['行迹加成'] ? `<div class="info-row" style="margin-top:8px"><dt>行迹加成</dt><dd>${esc(l80['行迹加成'])}</dd></div>` : ''}
        ${l80['终结技启动所需'] ? `<div class="info-row"><dt>终结技启动</dt><dd>${esc(l80['终结技启动所需'])}</dd></div>` : ''}
      </div>
      <div class="span-12 panel info-card"><h3>角色档案</h3><div class="story-short">${esc(cleanText(char.storyShort || char.summary || '暂无档案正文。'))}</div></div>
    </div>`;
  }

  function charSkills(char) {
    const skills = [...(char.skills || [])].sort((a, b) => (SKILL_ORDER[a.type] || 99) - (SKILL_ORDER[b.type] || 99));
    if (!skills.length) return `<div class="empty-state">该角色词条暂未收录技能数据。</div>`;
    return skills.map(skill => {
      const desc = (skill.entries || []).map(e => [e.description, ...(e.tags || []).filter(Boolean)].filter(Boolean).join('\n')).join('\n\n');
      const entries = (skill.entries || []).map(e => `
        ${e.description ? `<div class="skill-desc">${esc(cleanText(e.description))}</div>` : ''}
        ${e.tags?.length ? `<div class="skill-tags">${e.tags.filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        ${e.title ? `<div class="faint" style="font-size:11px;margin-top:6px">${esc(e.title)}</div>` : ''}
      `).join('');
      const table = skill.table?.rows?.length ? `
        <div class="skill-table-wrap"><table class="skill-table"><thead><tr>${(skill.table.headers || []).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
        ${skill.table.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>` : '';
      return `<article class="panel skill-card">
        <div class="skill-head">
          ${skill.icon ? `<img class="skill-icon" src="${escAttr(skill.icon)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div><div class="skill-type">${esc(skill.type || '技能')}</div><h3>${esc(skill.name || '未命名')}</h3></div>
        </div>
        ${entries || `<div class="skill-desc">${esc(cleanText(desc || '暂无描述。'))}</div>`}
        ${table}
      </article>`;
    }).join('');
  }

  function charEidolons(char) {
    const list = char.eidolons || [];
    if (!list.length) return `<div class="empty-state">该词条暂未收录星魂描述。</div>`;
    return `<div class="eidolon-list">${list.map(e => `
      <article class="panel eidolon-card"><div class="eidolon-num">${String(e.index || 0).padStart(2, '0')}</div><div><h3>${esc(e.name)}</h3><p>${esc(cleanText(e.description))}</p></div></article>`).join('')}</div>`;
  }

  function charStories(char) {
    const list = char.stories || [];
    if (!list.length) return `<div class="empty-state">该词条暂未收录角色故事。</div>`;
    return `<div class="story-accordion">${list.map(s => `
      <details><summary><span>${esc(s.title || '角色故事')}</span>${s.unlock ? `<span class="unlock-label">${esc(s.unlock)}</span>` : ''}</summary><div class="story-text">${esc(cleanText(s.text))}</div></details>`).join('')}</div>`;
  }

  function charVoices(char) {
    const groups = char.voices || [];
    const total = groups.reduce((n, g) => n + (g.lines?.length || 0), 0);
    if (!total) return `<div class="empty-state">该角色词条暂无语音文本。</div>`;
    const groupHtml = groups.map((g, gi) => `
      <h3 class="voice-group-title">${esc(g.name || `语音组 ${gi + 1}`)}</h3>
      ${(g.lines || []).map((v, vi) => `
        <div class="voice-line" data-voice="${gi}-${vi}" data-text="${escAttr(`${v.type} ${v.name} ${v.text} ${v.translations?.ja || ''} ${v.translations?.en || ''}`)}">
          <div class="voice-type">${esc(v.type || v.name || '语音')}</div>
          <div><div class="voice-text">${esc(cleanText(v.text))}</div>${v.translations?.en || v.translations?.ja ? `<div class="voice-translation">${v.translations?.ja ? `<div lang="ja">${esc(v.translations.ja)}</div>` : ''}${v.translations?.en ? `<div lang="en">${esc(v.translations.en)}</div>` : ''}</div>` : ''}</div>
          <div>${v.audioUrl ? `<button class="audio-toggle" data-audio="${escAttr(v.audioUrl)}" aria-label="播放语音">▶</button>` : `<button class="audio-toggle" data-translation="${gi}-${vi}" aria-label="显示翻译">译</button>`}</div>
        </div>`).join('')}`).join('');
    return `<div class="voice-toolbar"><label class="filter-search" style="max-width:360px"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg><input id="voice-search" type="search" placeholder="筛选语音类型或内容…"></label><span class="chip">${num(total)} 条</span></div><div id="voice-list">${groupHtml}</div>`;
  }

  function bindVoiceTab(char) {
    const list = $('#voice-list');
    $('#voice-search')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      $$('.voice-line', list).forEach(row => { row.hidden = !!q && !row.dataset.text.toLowerCase().includes(q); });
      $$('.voice-group-title', list).forEach(h => {
        let cursor = h.nextElementSibling;
        let hasVisibleLine = false;
        while (cursor && !cursor.classList.contains('voice-group-title')) {
          if (cursor.classList.contains('voice-line') && !cursor.hidden) { hasVisibleLine = true; break; }
          cursor = cursor.nextElementSibling;
        }
        h.hidden = !!q && !hasVisibleLine;
      });
    });
    $$('[data-audio]').forEach(btn => btn.addEventListener('click', () => {
      try {
        const audio = new Audio(btn.dataset.audio);
        audio.play().then(() => { btn.textContent = '■'; audio.onended = () => { btn.textContent = '▶'; }; }).catch(() => showToast('语音文件无法播放'));
      } catch { showToast('语音文件无法播放'); }
    }));
    $$('[data-translation]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('.voice-line');
      row.classList.toggle('show-translation');
    }));
  }

  function charGallery(char) {
    const list = (char.artworks || []).filter(a => a.image);
    if (!list.length) return `<div class="empty-state">该词条暂无立绘索引。</div>`;
    return `<div class="gallery-grid">${list.map((a, i) => `
      <button class="gallery-item" data-lightbox="${escAttr(a.image)}" data-caption="${escAttr(`${char.name} · ${a.name || '立绘'}`)}">
        <img src="${escAttr(a.thumb || a.image)}" alt="${escAttr(`${char.name} ${a.name || '立绘'}`)}" loading="lazy" onerror="this.src='${escAttr(a.image)}'">
        <span>${esc(a.name || '官方立绘')}</span>
      </button>`).join('')}</div>`;
  }

  function charSources(char) {
    const list = char.sources || [];
    const wikiFields = char.wiki?.fields || {};
    return `<div class="source-list">
      ${list.map(s => `<div class="source-row"><b>${esc(s.provider)}</b><span>${esc(s.type || '')}${s.updated ? ` · ${esc(s.updated)}` : ''}</span><a href="${escAttr(s.url)}" target="_blank" rel="noopener">打开原页面 ↗</a></div>`).join('') || '<div class="empty-state">没有来源记录。</div>'}
    </div>
    ${Object.keys(wikiFields).length ? `<div class="panel info-card" style="margin-top:14px"><h3>BWIKI 补充字段</h3><div class="info-list">${Object.entries(wikiFields).filter(([,v]) => v).map(([k,v]) => `<div class="info-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</div></div>` : ''}
    <p class="sources-note">角色与语音版权归米哈游及原权利人所有。图片以原始 CDN 地址引用，未复制、未转售；本项目不构成官方资料库。</p>`;
  }

  // ---------- story collection ----------
  function renderStories() {
    const typeCounts = S.stories.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {});
    const types = Object.entries(typeCounts).sort((a, b) => (TYPE_ORDER[a[0]] || 99) - (TYPE_ORDER[b[0]] || 99));
    setHTML(`
      <div class="collection-head">
        <div><div class="eyebrow">Story archive</div><h1>剧情卷宗</h1><p>按任务切卷，保留选项分支与说话人。</p></div>
        <span class="count">${num(S.stories.length)} 卷 · ${num(S.stories.reduce((n, s) => n + (s.lineCount || 0), 0))} 句（含分支）</span>
      </div>
      <div class="filter-bar">
        <label class="filter-search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg><input id="story-search" type="search" placeholder="搜索任务名、角色或描述…" value="${escAttr(S.storyFilters.q)}"></label>
        <div class="filter-group" id="story-type-filters">
          <button class="filter-chip ${S.storyFilters.type === 'all' ? 'active' : ''}" data-type="all">全部</button>
          ${types.map(([t, n]) => `<button class="filter-chip ${S.storyFilters.type === t ? 'active' : ''}" data-type="${escAttr(t)}">${esc(t)} ${n}</button>`).join('')}
        </div>
        <button class="filter-clear" id="clear-story-filters">清除</button>
      </div>
      <div class="story-list" id="story-list"></div>
      <div class="load-more" id="story-more"></div>
    `);
    $('#story-search').addEventListener('input', e => { S.storyFilters.q = e.target.value; S.storyFilters.limit = 36; renderStoryList(); });
    $$('[data-type]').forEach(btn => btn.addEventListener('click', () => { S.storyFilters.type = btn.dataset.type; S.storyFilters.limit = 36; renderStories(); }));
    $('#clear-story-filters').addEventListener('click', () => { S.storyFilters = { q: '', type: 'all', limit: 36 }; renderStories(); });
    renderStoryList();
  }

  function storyMatch(s) {
    const f = S.storyFilters;
    if (f.type !== 'all' && s.type !== f.type) return false;
    if (f.q) {
      const q = f.q.trim().toLowerCase();
      const hay = [s.name, s.type, s.region, s.version, s.series, s.description, (s.characters || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderStoryList() {
    const listEl = $('#story-list');
    if (!listEl) return;
    const all = S.stories.filter(storyMatch).sort((a, b) => versionNum(b.version) - versionNum(a.version) || a.name.localeCompare(b.name, 'zh'));
    const visible = all.slice(0, S.storyFilters.limit);
    if (!all.length) { listEl.innerHTML = '<div class="empty-state">没有匹配的剧情任务。</div>'; $('#story-more').innerHTML = ''; return; }
    listEl.innerHTML = visible.map(s => `
      <a class="story-card" href="#/story/${escAttr(s.id)}">
        <div class="story-card-version">${esc(s.version || '—')}<small>VERSION</small></div>
        <div><h3>${esc(s.name)}</h3><p>${esc(s.description || s.series || '')}</p><div class="meta">${esc(s.type)} · ${esc(s.region || '未知区域')}${s.characters?.length ? ` · ${esc(s.characters.slice(0, 3).join('、'))}` : ''}</div></div>
        <div class="line-count"><b>${num(s.lineCount)}</b>句</div>
      </a>`).join('');
    $('#story-more').innerHTML = all.length > S.storyFilters.limit ? `<button class="btn" id="load-more-stories">再展开 ${Math.min(36, all.length - S.storyFilters.limit)} 卷</button>` : `<span class="faint" style="font-size:11px">已显示全部 ${num(all.length)} 卷</span>`;
    $('#load-more-stories')?.addEventListener('click', () => { S.storyFilters.limit += 36; renderStoryList(); });
  }

  // ---------- story reader ----------
  async function openStory(id, token) {
    if (!id) { location.hash = '#/stories'; return; }
    setHTML(`<div class="boot-screen"><div class="boot-star"></div><p>正在展开剧情卷宗…</p></div>`);
    let story;
    try { story = await loadStory(id); }
    catch (err) { setHTML(`<div class="empty-state">剧情卷宗读取失败：${esc(err.message)}</div>`); return; }
    if (token !== S.routeToken) return;
    S.activeStory = story;
    document.title = `${story.name} · 星穹全典`;
    const sections = story.sections || [];
    const seenTitles = {};
    const sectionTitles = sections.map(s => {
      const title = cleanText(s.title) || '剧情内容';
      seenTitles[title] = (seenTitles[title] || 0) + 1;
      return seenTitles[title] > 1 ? `${title}（${seenTitles[title]}）` : title;
    });
    const toc = sections.map((s, i) => `<a href="#section-${i}" data-toc="${i}">${esc(sectionTitles[i])}</a>`).join('');
    setHTML(`
      <section class="story-hero">
        <a class="breadcrumb" href="#/stories">← 返回剧情卷宗</a>
        <div class="eyebrow">${esc(typeLabel(story.type))} · ${esc(story.version || '—')}</div>
        <h1>${esc(story.name)}</h1>
        <p class="lead">${esc(story.description || '')}</p>
        <div class="story-meta">
          <span class="chip gold">${num(story.lineCount)} 句台词 · 含分支</span>
          ${story.region ? `<span class="chip">${esc(story.region)}</span>` : ''}
          ${story.series ? `<span class="chip">${esc(story.series)}</span>` : ''}
          ${(story.characters || []).slice(0, 6).map(c => `<span class="chip">${esc(c)}</span>`).join('')}
        </div>
        ${story.sources?.[0]?.url ? `<div style="margin-top:18px"><a class="btn tiny" href="${escAttr(story.sources[0].url)}" target="_blank" rel="noopener">查看原始任务页 ↗</a></div>` : ''}
      </section>
      <div class="story-reader-layout">
        <aside class="story-toc"><h3>卷内目录</h3>${toc}</aside>
        <article class="story-reader" id="story-reader">
          ${sections.map((section, i) => `<section class="story-section" id="section-${i}"><h2>${esc(sectionTitles[i])}</h2>${renderBlocks(section.blocks || [])}</section>`).join('')}
          <div class="story-end">— 本卷终 —</div>
          <div class="story-next"><a class="btn" href="#/stories">← 剧情卷宗</a><a class="btn" href="#/characters">角色图鉴 →</a></div>
        </article>
      </div>
    `);
    $$('[data-toc]').forEach(link => link.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById(`section-${link.dataset.toc}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    if (S.storyFocus) {
      const focus = S.storyFocus;
      S.storyFocus = null;
      focusStoryLine(focus);
    }
  }

  function renderBlocks(blocks) {
    return blocks.map(block => {
      if (block.type === 'dialogue') {
        if (isNoise(block.text)) return '';
        return `<div class="reader-block dialogue ${block.speaker ? '' : 'no-speaker'}">${block.speaker ? `<span class="speaker">${esc(block.speaker)}</span>` : ''}<p>${esc(cleanText(block.text))}</p></div>`;
      }
      if (block.type === 'note') {
        if (isNoise(block.text)) return '';
        return `<div class="reader-block reader-note">${esc(cleanText(block.text))}${block.location ? ` <span class="faint">[${esc(block.location)}]</span>` : ''}</div>`;
      }
      if (block.type === 'heading') return `<div class="reader-heading">${esc(cleanText(block.text))}</div>`;
      if (block.type === 'cg') return `<div class="reader-block cg-block">剧情图像：${esc(cleanText(block.text).replace(/^\[图片：/, '').replace(/\]$/, ''))}</div>`;
      if (block.type === 'fold') {
        return `<details class="fold-block" ${block.open ? 'open' : ''}><summary>${esc(block.title || '额外内容')}</summary>${renderBlocks(block.blocks || [])}</details>`;
      }
      if (block.type === 'choice') {
        const opts = (block.options || []).map((o, i) => `<details class="choice-option" ${i === 0 ? 'open' : ''}><summary>${esc(o.label || `选项 ${i + 1}`)}</summary><div class="choice-body">${renderBlocks(o.blocks || [])}</div></details>`).join('');
        return `<div class="choice-block"><div class="choice-label">分支选择</div>${opts}</div>`;
      }
      return '';
    }).join('');
  }

  function focusStoryLine(focus) {
    const reader = $('#story-reader');
    if (!reader) return;
    const lines = $$('.dialogue', reader);
    let target = lines.find(line => {
      const speaker = line.querySelector('.speaker')?.textContent?.trim() || '';
      const text = line.querySelector('p')?.textContent?.trim() || '';
      return (!focus.speaker || speaker === focus.speaker) && text === focus.text;
    });
    if (!target) target = lines.find(line => (line.querySelector('p')?.textContent || '').includes(focus.text));
    if (!target) return;
    let parent = target.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
    target.classList.add('highlight');
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  // ---------- about ----------
  function renderAbout() {
    const counts = S.meta.counts;
    setHTML(`
      <section class="panel about-hero">
        <div class="eyebrow">About this archive</div>
        <h1>这不是一张巨型网页。</h1>
        <p>“星穹全典”把内容拆成角色索引、角色详情、剧情卷宗、语音与全文搜索索引。首次打开只载入目录；点开角色或剧情时再取对应的数据卷。它可以被静态托管，也可以在手机上安装后离线阅读已缓存的部分。</p>
      </section>
      <div class="about-grid">
        <article class="panel about-card"><h2>数据规模</h2><ul>
          <li>${num(counts.characters)} 位角色，其中 ${num(counts.officialPlatformCharacters)} 位来自米游社官方平台词条。</li>
          <li>${num(counts.skills)} 条技能、行迹、星魂与属性条目。</li>
          <li>${num(counts.voices)} 条角色语音文本，${num(counts.artworks)} 张立绘/头像索引。</li>
          <li>${num(counts.stories)} 卷任务剧情，${num(counts.storyLines)} 句可检索台词。</li>
        </ul></article>
        <article class="panel about-card"><h2>来源口径</h2><ul>
          <li><b>米游社·开拓者笔记</b>：米哈游提供平台技术支持，角色页由结构化 API 返回。</li>
          <li><b>哔哩哔哩 BWIKI</b>：玩家共建维基，用于任务正文、选项分支、部分缺失字段与立绘文件索引。</li>
          <li>每条角色和剧情都保留原页面链接；社区内容不会标成官方设定。</li>
        </ul></article>
        <article class="panel about-card"><h2>离线与检索</h2><ul>
          <li>角色详情按 <code>data/characters/*.json</code> 分卷，剧情按 <code>data/stories/*.json</code> 分卷。</li>
          <li>“全库台词”首次检索时载入 <code>data/search/story-lines.json</code>，之后由浏览器缓存。</li>
          <li>收藏保存在本机 localStorage，不上传服务器。</li>
        </ul></article>
        <article class="panel about-card"><h2>边界与声明</h2><ul>
          <li>本项目是非官方、非商业的玩家资料整理，不隶属米哈游。</li>
          <li>角色、剧情、语音、立绘版权归米哈游及原权利人；转载或再利用前请核对原站条款。</li>
          <li>Wiki 任务页并不等于游戏内全部文本；部分演出、道具描述和未归档对白可能缺失。</li>
          <li>发现错误请以原页面为准；本项目不修改、不伪造官方设定。</li>
        </ul></article>
        <article class="panel about-card"><h2>本地运行</h2><p>在项目目录执行：</p><p><code>python3 -m http.server 8080</code></p><p>然后打开 <code>http://localhost:8080</code>。不要直接双击 HTML；浏览器会阻止读取本地 JSON。</p></article>
        <article class="panel about-card"><h2>更新数据</h2><p>运行 <code>python3 tools/import_data.py all</code> 重新抓取；原始响应会缓存在 <code>.work/cache</code>，不会提交到版本库。</p><p>数据生成时间：${esc(S.meta.generatedAt || '')}</p></article>
      </div>
    `);
  }

  // ---------- search ----------
  function openSearch() {
    const overlay = $('#search-overlay');
    overlay.hidden = false;
    setTimeout(() => $('#search-input')?.focus(), 30);
    if (!$('#search-input').value) renderSearchEmpty();
    else runSearch();
  }
  function closeSearch() {
    $('#search-overlay').hidden = true;
    $('#search-input')?.blur();
  }
  function renderSearchEmpty() {
    $('#search-results').innerHTML = `<div class="search-empty"><span class="search-orbit" aria-hidden="true"></span><p>输入关键词，开始检索这座档案库。</p><small>词条模式检索角色与任务；台词模式会在首次使用时载入约 ${num(S.meta?.counts?.storyLines || 89609)} 句剧情文本。</small></div>`;
  }
  function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlight(value, query) {
    const text = String(value || '');
    if (!query) return esc(text);
    const lower = text.toLowerCase(), q = query.toLowerCase();
    let i = 0, out = '';
    while (i < text.length) {
      const at = lower.indexOf(q, i);
      if (at < 0) { out += esc(text.slice(i)); break; }
      out += esc(text.slice(i, at)) + `<em>${esc(text.slice(at, at + q.length))}</em>`;
      i = at + q.length;
    }
    return out;
  }

  function searchEntries(query) {
    const q = query.trim().toLowerCase();
    if (!q) { renderSearchEmpty(); return; }
    const chars = S.characters.filter(c => [c.name, c.faction, c.version, pathLabel(c.path), elementLabel(c.element), c.summary].join(' ').toLowerCase().includes(q)).slice(0, 10);
    const stories = S.stories.filter(s => [s.name, s.type, s.version, s.region, s.series, s.description, (s.characters || []).join(' ')].join(' ').toLowerCase().includes(q)).slice(0, 30);
    let html = '';
    if (chars.length) html += `<div class="search-group"><h3>角色 · ${chars.length}</h3>${chars.map(c => `
      <button class="search-result" data-search-char="${escAttr(c.id)}">
        ${c.icon ? `<img src="${escAttr(c.icon)}" alt="" loading="lazy">` : '<span class="char-icon"></span>'}
        <div class="sr-copy"><b>${highlight(c.name, query)}</b><small>${esc(elementLabel(c.element))} · ${esc(pathLabel(c.path))} · ${esc(c.version || '—')}</small></div><span class="sr-arrow">›</span>
      </button>`).join('')}</div>`;
    if (stories.length) html += `<div class="search-group"><h3>剧情 · ${stories.length}</h3>${stories.map(s => `
      <button class="search-result" data-search-story="${escAttr(s.id)}">
        <div class="sr-copy"><b>${highlight(s.name, query)}</b><small>${esc(s.type)} · ${esc(s.version || '—')} · ${num(s.lineCount)} 句</small></div><span class="sr-arrow">›</span>
      </button>`).join('')}</div>`;
    if (!html) html = `<div class="search-empty"><span class="search-orbit"></span><p>没有匹配的词条。</p><small>换一个角色名、版本号或任务关键词试试。</small></div>`;
    const el = $('#search-results');
    el.innerHTML = html;
    $$('[data-search-char]').forEach(btn => btn.addEventListener('click', () => { closeSearch(); location.hash = `#/character/${btn.dataset.searchChar}`; }));
    $$('[data-search-story]').forEach(btn => btn.addEventListener('click', () => { closeSearch(); location.hash = `#/story/${btn.dataset.searchStory}`; }));
  }

  async function loadSearchIndex() {
    if (S.searchIndex) return S.searchIndex;
    if (S.searchLoading) return null;
    S.searchLoading = true;
    $('#line-index-state').textContent = '载入中…';
    $('#search-results').innerHTML = '<div class="search-loading"><div class="boot-star"></div><p>正在载入全库台词索引…</p><small>约 12 MB，只会在这台设备上载入一次。</small></div>';
    try {
      const data = await fetchJSON('search/story-lines.json');
      S.searchIndex = data.entries || [];
      $('#line-index-state').textContent = `${num(S.searchIndex.length)} 句`;
      S.searchLoading = false;
      return S.searchIndex;
    } catch (err) {
      S.searchLoading = false;
      $('#line-index-state').textContent = '载入失败';
      $('#search-results').innerHTML = `<div class="empty-state">台词索引载入失败：${esc(err.message)}</div>`;
      return [];
    }
  }

  async function searchLines(query) {
    const q = query.trim().toLowerCase();
    if (!q) { renderSearchEmpty(); return; }
    if (!S.searchIndex) await loadSearchIndex();
    if (!S.searchIndex) return;
    const found = [];
    for (const line of S.searchIndex) {
      if (line.x.toLowerCase().includes(q) || (line.p && line.p.toLowerCase().includes(q))) {
        found.push(line);
        if (found.length >= 80) break;
      }
    }
    if (!found.length) {
      $('#search-results').innerHTML = `<div class="search-empty"><span class="search-orbit"></span><p>没有匹配的台词。</p><small>可尝试角色名、关键词或更短的片段。</small></div>`;
      return;
    }
    $('#search-results').innerHTML = `<div class="search-group"><h3>剧情台词 · 命中前 ${found.length} 条</h3>${found.map((line, i) => `
      <button class="search-result line-result" data-line-index="${i}">
        <div class="sr-copy"><b>${highlight(line.t, query)}</b><small>${esc(line.h)}</small><p><span class="speaker">${esc(line.p || '旁白')}</span>${highlight(line.x, query)}</p></div><span class="sr-arrow">›</span>
      </button>`).join('')}</div><div class="search-limit">仅显示前 80 条命中结果</div>`;
    $$('[data-line-index]').forEach(btn => btn.addEventListener('click', () => {
      const line = found[Number(btn.dataset.lineIndex)];
      S.storyFocus = { speaker: line.p, text: line.x };
      closeSearch();
      location.hash = `#/story/${line.s}`;
    }));
  }

  function runSearch() {
    const query = $('#search-input').value;
    if (S.searchMode === 'lines') searchLines(query); else searchEntries(query);
  }

  // ---------- UI wiring ----------
  function bindGlobalUI() {
    $('#search-trigger').addEventListener('click', openSearch);
    $$('[data-close-search]').forEach(el => el.addEventListener('click', closeSearch));
    let searchTimer;
    $('#search-input').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 180);
    });
    $$('[data-search-mode]').forEach(btn => btn.addEventListener('click', () => {
      S.searchMode = btn.dataset.searchMode;
      $$('[data-search-mode]').forEach(b => b.classList.toggle('active', b === btn));
      runSearch();
    }));
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (e.key === '/' && !typing) { e.preventDefault(); openSearch(); }
      if (e.key === 'Escape') {
        if (!$('#search-overlay').hidden) closeSearch();
        if (!$('#lightbox').hidden) closeLightbox();
      }
    });
    window.addEventListener('scroll', () => {
      $('#topbar').classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
    window.addEventListener('hashchange', route);
    $('#lightbox')?.addEventListener('click', e => { if (e.target.id === 'lightbox' || e.target.closest('[data-close-lightbox]')) closeLightbox(); });
    document.addEventListener('click', e => {
      const item = e.target.closest('[data-lightbox]');
      if (item) openLightbox(item.dataset.lightbox, item.dataset.caption);
    });
    // Make any gallery re-render still bind its lightbox triggers.
    document.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      S.installPrompt = e;
      if (!localStorage.getItem(INSTALL_DISMISSED_KEY)) $('#install-button').hidden = false;
    });
    $('#install-button')?.addEventListener('click', async () => {
      if (!S.installPrompt) { showToast('请使用浏览器菜单中的“添加到主屏幕”'); return; }
      S.installPrompt.prompt();
      const choice = await S.installPrompt.userChoice;
      if (choice.outcome !== 'accepted') localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      S.installPrompt = null;
      $('#install-button').hidden = true;
    });
    window.addEventListener('appinstalled', () => { $('#install-button').hidden = true; showToast('已安装到设备'); });
  }

  function bindGallery() { /* lightbox uses document delegation */ }

  function openLightbox(src, caption) {
    if (!src) return;
    const box = $('#lightbox');
    $('#lightbox-image').src = src;
    $('#lightbox-image').alt = caption || '立绘';
    $('#lightbox-caption').textContent = caption || '';
    box.hidden = false;
  }
  function closeLightbox() {
    $('#lightbox').hidden = true;
    $('#lightbox-image').src = '';
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
    }
  }

  boot();
})();
