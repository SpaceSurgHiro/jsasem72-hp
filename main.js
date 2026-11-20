/* =========================================================
   第72回 日本宇宙航空環境医学会大会 公式サイト 共通スクリプト
   全ページ共有（header・モバイルメニュー・カウントダウン）
   ========================================================= */

// Header background on scroll（トップページの透過ヘッダー用）
const header = document.getElementById('header');
addEventListener('scroll', () => {
  if (header) header.classList.toggle('scrolled', scrollY > 40);
});

// Mobile menu
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');
if (burger && nav) {
  burger.addEventListener('click', () => nav.classList.toggle('open'));
  nav.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => nav.classList.remove('open')));
}

// Countdown to 2026-12-04（カウントダウン要素があるページのみ）
const cd = document.getElementById('cd-num');
if (cd) {
  const target = new Date('2026-12-04T00:00:00+09:00');
  const days = Math.max(0, Math.ceil((target - new Date()) / 86400000));
  cd.innerHTML = days + ' <small>日</small>';
}

// エクスカーションの申込ボタン：受付開始（2026-11-02 12:00 JST）までは押せない状態で表示する
const excursionOpen = new Date('2026-11-02T12:00:00+09:00');
if (new Date() >= excursionOpen) {
  document.querySelectorAll('[data-excursion-open]').forEach(a => {
    a.href = a.dataset.excursionOpen;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = a.dataset.openLabel;
    a.classList.remove('is-closed');
    a.removeAttribute('role');
    a.removeAttribute('aria-disabled');
  });
}

// 2026-11-16：12/6 公開シンポジウム（市民公開講座）のポスターをポップアップで表示する。
// [data-poster] のリンクを押すと開く（href はポスターの PDF。dialog が使えないブラウザでは PDF がそのまま開く）。
// ページを開いたときの URL の末尾が #symposium-poster なら、最初から開く（お知らせなどからの直リンク用）。
(function () {
  const POSTER = {
    title: '12月6日（日）公開シンポジウム（市民公開講座）「大分宇宙港〜地方から宇宙へ」',
    pdf: 'assets/poster/symposium-1206.pdf',
    pages: [
      { src: 'assets/poster/symposium-1206-1.jpg', alt: '公開シンポジウム「大分宇宙港〜地方から宇宙へ」ポスター（表）：2026年12月6日（日）14:00〜16:30（開場13:30）、J:COMホルトホール大分 3階 大会議室、参加無料・事前申込不要。基調講演「JAXA宇宙飛行士講演会」講師 星出彰彦 氏' },
      { src: 'assets/poster/symposium-1206-2.jpg', alt: '公開シンポジウム ポスター（裏）：シンポジウムプログラム（基調講演・取組紹介・パネルディスカッション）と主催・共催・後援' }
    ]
  };
  const triggers = document.querySelectorAll('[data-poster]');
  if (!triggers.length || typeof HTMLDialogElement !== 'function') return;
  let dlg = null, lastFocus = null;
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'pmodal';
    dlg.setAttribute('aria-label', POSTER.title);
    const imgs = POSTER.pages.map(p => '<img src="' + p.src + '" alt="' + p.alt + '" width="1240" height="1754" loading="lazy">').join('');
    dlg.innerHTML =
      '<div class="pmodal__bar"><div class="pmodal__ttl">' + POSTER.title + '</div>' +
      '<a class="pmodal__pdf" href="' + POSTER.pdf + '" target="_blank" rel="noopener">PDF・印刷</a>' +
      '<button type="button" class="pmodal__close" aria-label="閉じる">×</button></div>' +
      '<div class="pmodal__body">' + imgs + '<p class="pmodal__note">参加無料・事前申込不要　｜　お問合せ：第72回日本宇宙航空環境医学会大会事務局（jsasem72.office@gmail.com）</p></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('.pmodal__close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      document.documentElement.style.overflow = '';
      if (location.hash === '#symposium-poster') history.replaceState(null, '', location.pathname + location.search);
      if (lastFocus) lastFocus.focus();
    });
  }
  function open(from) {
    if (!dlg) build();
    lastFocus = from || null;
    document.documentElement.style.overflow = 'hidden';
    dlg.showModal();
    dlg.querySelector('.pmodal__body').scrollTop = 0;
    dlg.querySelector('.pmodal__close').focus();
  }
  triggers.forEach(a => a.addEventListener('click', e => { e.preventDefault(); open(a); }));
  if (location.hash === '#symposium-poster') open(null);
})();

// ---------------------------------------------------------------------------
// 協賛企業・団体の広告（sponsor.html #ads）
// [data-ad] に画像のパスを「|」区切りで書く（複数ページの広告は縦に並べる）。data-ad-title が見出し。
// dialog が使えないブラウザでは、リンク（href の画像）がそのまま開く。
(function () {
  const triggers = document.querySelectorAll('[data-ad]');
  if (!triggers.length || typeof HTMLDialogElement !== 'function') return;
  let dlg = null, lastFocus = null;
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'pmodal';
    dlg.innerHTML =
      '<div class="pmodal__bar"><div class="pmodal__ttl"></div>' +
      '<button type="button" class="pmodal__close" aria-label="閉じる">×</button></div>' +
      '<div class="pmodal__body"></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('.pmodal__close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      document.documentElement.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    });
  }
  function open(a) {
    if (!dlg) build();
    lastFocus = a;
    const title = a.getAttribute('data-ad-title') || '広告';
    dlg.setAttribute('aria-label', title + 'の広告');
    dlg.querySelector('.pmodal__ttl').textContent = title;
    const body = dlg.querySelector('.pmodal__body');
    body.textContent = '';
    a.getAttribute('data-ad').split('|').forEach((src, i, all) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = title + 'の広告' + (all.length > 1 ? '（' + (i + 1) + 'ページ目）' : '');
      img.width = 1240; img.height = 1754;
      body.appendChild(img);
    });
    document.documentElement.style.overflow = 'hidden';
    dlg.showModal();
    body.scrollTop = 0;
    dlg.querySelector('.pmodal__close').focus();
  }
  triggers.forEach(a => a.addEventListener('click', e => { e.preventDefault(); open(a); }));
})();
