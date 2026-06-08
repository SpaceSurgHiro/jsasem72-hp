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
