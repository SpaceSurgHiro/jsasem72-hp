/* =========================================================
   第72回 日本宇宙航空環境医学会大会　当日の受付アプリ（checkin.html）
   2026-11-17 作成。iPad の Safari で使う。
   ・事務局の Apps Script（register-config.js の endpoint）に、合言葉（STAFF_KEY）つきで問い合わせる。
   ・名簿は起動時と「名簿を更新」のときに受け取り、この iPad の中で検索・照合する（読み取りの表示を速くするため）。
   ・受付（来場の記録）と認定医のチェックは、すぐに送る。通信できないときは、この iPad にためて、あとで送る。
   ・QRコードの中身は登録番号（J72-0000-XXXX）。読み取りは jsQR。
   ========================================================= */
(function () {
  'use strict';
  var CFG = window.JSASEM72_REG || {};
  var EP = CFG.endpoint || '';
  var LS = {
    key: 'jsasem72.staffKey', roster: 'jsasem72.roster', rosterAt: 'jsasem72.rosterAt',
    queue: 'jsasem72.queue', sound: 'jsasem72.optSound', front: 'jsasem72.optFront'
  };
  var ID_RE = /J72-?\d{4}-?[A-Z0-9]{4}/i;
  var CAT_CLASS = { '学生': 'student', '研修医': 'comed', '非会員': 'non', '招待': 'invite' };
  var ONSITE = { MEMBER: 16000, NONMEMBER: 18000, COMED: 8000, STUDENT: 0 };
  var PRE = { MEMBER: 15000, NONMEMBER: 17000, COMED: 7000, STUDENT: 0 };
  var LABELS = { MEMBER: '会員', NONMEMBER: '非会員', COMED: '研修医・コメディカル', STUDENT: '学生（小学生〜大学院生）' };

  var $ = function (id) { return document.getElementById(id); };
  var KEY = store('get', LS.key) || '';
  var roster = [];          // 名簿（Apps Script の staffRecord_ の形）
  var byId = {};
  var rosterAt = '';
  var queue = parseJSON(store('get', LS.queue)) || [];
  var stream = null, scanning = false, useFront = store('get', LS.front) === '1', lastCode = '', lastAt = 0;
  var audio = null;
  var selectedId = '';
  var listFilter = 'all';

  /* ---------- 小道具 ---------- */
  function store(op, k, v) {
    try {
      if (op === 'get') return localStorage.getItem(k);
      if (op === 'set') localStorage.setItem(k, v);
      if (op === 'del') localStorage.removeItem(k);
    } catch (e) { /* プライベートモードなど */ }
    return null;
  }
  function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function normId(s) {
    var m = String(s || '').toUpperCase().replace(/[－ー―‐]/g, '-').replace(/\s/g, '').match(ID_RE);
    if (!m) return '';
    var raw = m[0].replace(/-/g, '');
    return raw.slice(0, 3) + '-' + raw.slice(3, 7) + '-' + raw.slice(7, 11);
  }
  function jstParts(d) {
    var f = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    var o = {};
    f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return { md: o.month + '/' + o.day, hm: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute };
  }
  function today() { return jstParts(new Date()).md; }
  function visitToday(r) {
    var d = today() + ' ';
    var hit = String(r.visits || '').split(/[、,]\s*/).filter(function (s) { return s.indexOf(d) === 0; })[0];
    return hit ? hit.slice(d.length) : '';
  }
  function kindOf(r) {
    var via = String(r.via || ''), cat = String(r.cat || '');
    if (/招待/.test(via) || /招待/.test(cat)) return '招待';
    if (/当日/.test(via)) return '当日受付（現金）';
    if (/振込/.test(via)) return '事前登録（銀行振込）';
    if (/学生/.test(cat) && r.fee === 0) return '事前登録（学生・無料）';
    if (r.fee === 0) return '事前登録（無料）';
    return '事前登録（クレジットカード）';
  }
  function catShort(cat) { return /学生/.test(cat) ? '学生' : cat; }
  function catClass(cat) {
    for (var k in CAT_CLASS) if (String(cat).indexOf(k) === 0) return CAT_CLASS[k];
    return '';
  }
  function yen(n) { return Number(n || 0).toLocaleString('ja-JP') + '円'; }
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.style.display = 'none'; }, ms || 2600);
  }
  function beep(ok) {
    if (store('get', LS.sound) === '0') return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = ok ? 1320 : 330;
      g.gain.setValueAtTime(0.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.18 : 0.45));
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.2 : 0.5));
    } catch (e) { /* 音が出せなくても続ける */ }
  }

  /* ---------- 通信 ---------- */
  function api(action, data) {
    if (!EP) return Promise.reject(new Error('送信先（Apps Script）が設定されていません。'));
    var body = Object.assign({ action: action, key: KEY }, data || {});
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    // Content-Type を付けない（text/plain）＝ 事前確認（CORS preflight）が起きない形
    return fetch(EP, { method: 'POST', body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (res) { return res.json(); })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        if (j && j.auth === false) { logout(true); throw new Error(j.error || '合言葉が違います。'); }
        return j;
      }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function setSync(text, cls) {
    var p = $('sync');
    p.textContent = text; p.className = 'pill' + (cls ? ' ' + cls : '');
  }
  function showQueue() {
    var q = $('queue');
    if (queue.length) { q.hidden = false; q.textContent = '通信待ち ' + queue.length + '件'; } else q.hidden = true;
  }
  function saveQueue() { store('set', LS.queue, JSON.stringify(queue)); showQueue(); }

  function loadRoster(quiet) {
    if (!quiet) setSync('名簿を受け取り中…');
    return api('staff_roster').then(function (j) {
      if (!j.ok) throw new Error(j.error || '名簿を受け取れませんでした。');
      setRoster(j.roster || [], new Date().toISOString());
      // メールアドレスは iPad に保存しない（検索は通信できているあいだだけ使える）
      store('set', LS.roster, JSON.stringify(roster.map(function (r) { var c = Object.assign({}, r); delete c.email; return c; })));
      store('set', LS.rosterAt, rosterAt);
      return flushQueue();
    }).catch(function (e) {
      setSync('名簿：通信できません（' + (rosterAt ? jstParts(new Date(rosterAt)).hm + ' の名簿で動作中' : '名簿なし') + '）', 'ng');
      if (!quiet) toast('名簿を受け取れませんでした：' + e.message, 4000);
    });
  }
  function setRoster(list, at) {
    roster = list; rosterAt = at; byId = {};
    roster.forEach(function (r) { byId[r.id] = r; });
    var t = jstParts(new Date(at));
    setSync('名簿 ' + roster.length + '件・' + t.md + ' ' + t.hm + ' 更新');
    renderList(); renderStats();
  }
  function upsert(rec) {
    if (!rec || !rec.id) return;
    if (byId[rec.id]) Object.assign(byId[rec.id], rec);
    else { roster.push(rec); byId[rec.id] = rec; }
    renderList(); renderStats();
  }
  function flushQueue() {
    if (!queue.length) return Promise.resolve();
    var item = queue[0];
    var p = item.type === 'cme' ? api('staff_cme', { id: item.id, on: item.on }) : api('staff_checkin', { id: item.id, at: item.at, force: item.force, reason: item.reason });
    return p.then(function (j) {
      queue.shift(); saveQueue();
      if (j && j.rec) {
        upsert(j.rec);
        // 「通信待ち」のまま表示しているカードを、送れた内容に描き直す
        document.querySelectorAll('.result').forEach(function (box) {
          if (box.dataset.id === j.rec.id && box.dataset.waiting === '1') { box.dataset.waiting = ''; renderCard(box, byId[j.rec.id], { state: j.admitted === false ? 'ng' : 'ok' }); }
        });
      }
      return flushQueue();
    }, function () { showQueue(); });
  }
  setInterval(function () { if (KEY && queue.length) flushQueue(); }, 20000);
  setInterval(function () { if (KEY && document.visibilityState === 'visible') loadRoster(true); }, 180000);
  window.addEventListener('online', function () { if (KEY) loadRoster(true); });

  /* ---------- 受付（読み取り → 表示 → 記録） ---------- */
  function handleCode(text, viewId) {
    var id = normId(text);
    var box = $(viewId || 'scan-result');
    if (!id) { beep(false); box.innerHTML = '<div class="banner warn">この QRコードは参加証ではありません</div><p class="hint">' + esc(String(text).slice(0, 80)) + '</p>'; return; }
    var r = byId[id];
    if (r && !r.ok) { beep(false); renderCard(box, r, { state: 'ng' }); return; }
    if (r) {
      var already = visitToday(r);
      beep(true);
      renderCard(box, r, { state: 'ok', already: already, pending: !already });
      if (!already) {
        var t = jstParts(new Date());
        r.visits = (r.visits ? r.visits + '、' : '') + t.md + ' ' + t.hm; // 先に画面へ反映（あとでサーバーの値に置き換わる）
        checkin(id, {}, box);
      }
      return;
    }
    // 名簿にない（名簿を受け取ったあとの登録など）→ サーバーに問い合わせる
    box.innerHTML = '<div class="banner warn">確認中… <small>' + esc(id) + '</small></div>';
    checkin(id, {}, box);
  }
  function checkin(id, opt, box) {
    var at = new Date().toISOString();
    return api('staff_checkin', Object.assign({ id: id, at: at }, opt || {})).then(function (j) {
      if (!j.ok && j.notFound) { beep(false); box.innerHTML = '<div class="banner ng">✕ 登録が見つかりません</div><p class="hint">登録番号 ' + esc(id) + '。「検索」でお名前から探すか、当日受付で登録してください。</p>'; return; }
      if (!j.ok) throw new Error(j.error || '記録できませんでした。');
      upsert(j.rec);
      if (!j.admitted) { beep(false); renderCard(box, j.rec, { state: 'ng' }); return; }
      if (box.dataset.id === j.rec.id || !box.dataset.id) renderCard(box, j.rec, { state: 'ok', already: j.already ? visitToday(j.rec) : '' });
    }).catch(function () {
      queue.push(Object.assign({ type: 'checkin', id: id, at: at }, opt || {})); saveQueue();
      box.dataset.waiting = '1';
      var note = box.querySelector('.syncnote'), small = box.querySelector('.banner small');
      if (small) small.textContent = '通信待ち（この iPad に記録しました）';
      if (note) note.textContent = '通信できないため、この iPad に記録しました。通信が戻ると自動で送ります。';
      else if (!byId[id]) box.innerHTML = '<div class="banner warn">通信できません</div><p class="hint">登録番号 ' + esc(id) + ' の受付を、この iPad に記録しました。名簿にない番号のため、支払いの確認は通信が戻ってから行ってください。</p>';
    });
  }
  function renderCard(box, r, o) {
    box.dataset.id = r.id;
    box.dataset.waiting = '';
    var banner;
    if (o.state === 'ok') {
      banner = o.already ? '<div class="banner ok">✓ 受付済み <small>本日 ' + esc(o.already) + ' に受付</small></div>'
                         : '<div class="banner ok">✓ 受付OK <small>' + (o.pending ? '記録中…' : '本日の受付を記録しました') + '</small></div>';
    } else if (o.state === 'ng') {
      banner = '<div class="banner ng">✕ 支払いが確認できません <small>状態：' + esc(r.st || '不明') + '</small></div>';
    } else {
      var v = visitToday(r);
      banner = r.ok ? (v ? '<div class="banner ok">✓ 本日 ' + esc(v) + ' に受付済み</div>' : '<div class="banner warn">本日はまだ受付していません</div>')
                    : '<div class="banner ng">✕ 支払いが確認できません <small>状態：' + esc(r.st || '不明') + '</small></div>';
    }
    var cc = catClass(r.cat);
    var html = banner +
      '<div class="who"><div class="kana">' + esc(r.kana) + '</div><div class="name">' + esc(r.name) + ' <span style="font-size:20px">様</span></div><div class="aff">' + esc(r.aff) + '</div></div>' +
      '<div class="chips"><span class="chip cat ' + cc + '">' + esc(catShort(r.cat)) + '</span><span class="chip kind">' + esc(kindOf(r)) + '</span><span class="chip">' + (r.fee ? yen(r.fee) : '参加費なし') + '</span></div>' +
      '<dl class="meta"><dt>登録番号</dt><dd>' + esc(r.id) + '</dd><dt>来場の記録</dt><dd>' + esc(r.visits || 'なし') + '</dd>' +
      (r.memo ? '<dt>受付メモ</dt><dd>' + esc(r.memo) + '</dd>' : '') + '</dl>' +
      (/学生/.test(r.cat) ? '<p class="hint" style="font-weight:700;color:#2f6f3e">学生証をご確認ください。</p>' : '') +
      '<button class="cme' + (r.cme ? ' on' : '') + '" data-cme="' + esc(r.id) + '"><span class="box2">' + (r.cme ? '✓' : '') + '</span>宇宙航空医学認定医（更新単位）' + (r.cme ? '：チェック済み' : '') + '</button>';
    if (o.state === 'ng' || (o.state === 'view' && !r.ok)) {
      html += '<div class="btnrow"><button class="btn ng" data-force="' + esc(r.id) + '">事情を確認して受け付ける</button></div>';
    } else if (o.state === 'view' && !visitToday(r)) {
      html += '<div class="btnrow"><button class="btn gold" data-checkin="' + esc(r.id) + '" style="width:100%;font-size:20px">受付する</button></div>';
    }
    html += '<div class="syncnote"></div>';
    box.innerHTML = html;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cme]');
    if (b) {
      var id = b.getAttribute('data-cme'), r = byId[id] || {};
      var on = !r.cme;
      r.cme = on ? (jstParts(new Date()).md + ' ' + jstParts(new Date()).hm + ' ✓') : '';
      b.classList.toggle('on', on);
      b.innerHTML = '<span class="box2">' + (on ? '✓' : '') + '</span>宇宙航空医学認定医（更新単位）' + (on ? '：チェック済み' : '');
      api('staff_cme', { id: id, on: on }).then(function (j) { if (j.ok) upsert(j.rec); else throw new Error(j.error); })
        .catch(function () { queue.push({ type: 'cme', id: id, on: on }); saveQueue(); toast('通信できないため、あとで送ります'); });
      renderStats();
      return;
    }
    b = e.target.closest('[data-checkin]');
    if (b) {
      var cid = b.getAttribute('data-checkin');
      var box = b.closest('.result');
      beep(true);
      box.querySelector('[data-checkin]').disabled = true;
      checkin(cid, {}, box);
      return;
    }
    b = e.target.closest('[data-force]');
    if (b) { openForce(b.getAttribute('data-force'), b.closest('.result')); }
  });

  /* ---------- 支払いが確認できない方を受け付ける ---------- */
  var forceTarget = null;
  function openForce(id, box) { forceTarget = { id: id, box: box }; $('force-reason').value = ''; $('force-dlg').classList.add('on'); setTimeout(function () { $('force-reason').focus(); }, 50); }
  $('force-cancel').addEventListener('click', function () { $('force-dlg').classList.remove('on'); });
  $('force-go').addEventListener('click', function () {
    var reason = $('force-reason').value.trim();
    if (!reason) { $('force-reason').focus(); toast('理由を入れてください'); return; }
    $('force-dlg').classList.remove('on');
    var t = forceTarget;
    t.box.innerHTML = '<div class="banner warn">記録中…</div>';
    checkin(t.id, { force: true, reason: reason }, t.box);
  });

  /* ---------- カメラ・QR ---------- */
  var video = $('video'), canvas = document.createElement('canvas'), ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  function startCam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('cam-msg').textContent = 'このブラウザではカメラが使えません。登録番号を入れてください。'; return; }
    stopCam();
    $('cam-msg').textContent = 'カメラを準備中…';
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: useFront ? 'user' : 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function (s) {
        stream = s; video.srcObject = s;
        video.style.transform = useFront ? 'scaleX(-1)' : '';
        return video.play();
      })
      .then(function () {
        $('cam-msg').textContent = ''; $('frame').hidden = false;
        $('cam-start').disabled = true; $('cam-stop').disabled = false; $('cam-flip').disabled = false;
        scanning = true; tick();
      })
      .catch(function (e) {
        $('cam-msg').innerHTML = 'カメラを使えませんでした。<br>Safari の「設定 → カメラ」で、このサイトを「許可」にしてください。<br><small>' + esc(e && e.name || '') + '</small>';
      });
  }
  function stopCam() {
    scanning = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; video.srcObject = null; $('frame').hidden = true;
    $('cam-start').disabled = false; $('cam-stop').disabled = true; $('cam-flip').disabled = true;
    $('cam-msg').textContent = '「カメラを開始」を押してください';
  }
  var lastTick = 0;
  function tick(ts) {
    if (!scanning) return;
    requestAnimationFrame(tick);
    if (ts && ts - lastTick < 110) return; // 1秒に9回ほど
    lastTick = ts || 0;
    if (video.readyState < 2 || !video.videoWidth) return;
    var w = video.videoWidth, h = video.videoHeight, scale = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
    var img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    var code = window.jsQR ? window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }) : null;
    if (code && code.data) {
      var now = Date.now();
      if (code.data === lastCode && now - lastAt < 4000) return; // 同じ QR を続けて読まない
      lastCode = code.data; lastAt = now;
      handleCode(code.data, 'scan-result');
    }
  }
  $('cam-start').addEventListener('click', function () { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {} startCam(); });
  $('cam-stop').addEventListener('click', stopCam);
  $('cam-flip').addEventListener('click', function () { useFront = !useFront; startCam(); });
  $('manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('manual-id').value;
    if (!normId(v)) { toast('登録番号の形（J72-0000-XXXX）で入れてください'); return; }
    lastCode = ''; handleCode(v, 'scan-result'); $('manual-id').value = '';
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && stream) stopCam(); });

  /* ---------- 検索 ---------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[\s　・\-－]/g, '').replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  function renderList() {
    var q = norm($('q').value), d = today();
    var rows = roster.filter(function (r) {
      if (listFilter === 'notyet' && (!r.ok || visitToday(r))) return false;
      if (listFilter === 'ng' && r.ok) return false;
      if (listFilter === 'cme' && !r.cme) return false;
      if (!q) return true;
      return [r.name, r.kana, r.aff, r.id, r.email].some(function (x) { return norm(x).indexOf(q) >= 0; });
    }).sort(function (a, b) { return String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'); });
    var shown = rows.slice(0, 200);
    $('list').innerHTML = shown.map(function (r) {
      var v = visitToday(r);
      return '<div class="item' + (r.id === selectedId ? ' sel' : '') + '" data-pick="' + esc(r.id) + '"><div class="l"><div class="n">' + esc(r.name) + '</div><div class="s">' + esc(r.kana) + '｜' + esc(r.aff) + '｜' + esc(catShort(r.cat)) + '｜' + esc(r.id) + '</div></div>' +
        (r.ok ? '' : '<span class="dot ng">未確認</span>') + (v ? '<span class="dot in">' + esc(d + ' ' + v) + '</span>' : '') + (r.cme ? '<span class="dot ok">認定医</span>' : '') + '</div>';
    }).join('') || '<div class="item"><div class="l"><div class="s">該当する方はいません</div></div></div>';
    $('list-count').textContent = rows.length + '件' + (rows.length > 200 ? '（先頭の200件を表示）' : '');
  }
  $('q').addEventListener('input', renderList);
  document.querySelectorAll('[data-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      listFilter = b.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('gold', x === b); x.classList.toggle('sub', x !== b); });
      renderList();
    });
  });
  $('list').addEventListener('click', function (e) {
    var it = e.target.closest('[data-pick]');
    if (!it) return;
    selectedId = it.getAttribute('data-pick');
    renderList();
    renderCard($('search-result'), byId[selectedId], { state: 'view' });
  });

  /* ---------- 当日・振込・招待の登録 ---------- */
  var kind = 'onsite';
  var KIND_HINT = {
    onsite: '当日の参加費（現金）をいただいてから登録します。登録すると、その場で本日の受付も記録されます。参加証は、当日用の用紙（手書き）に、お名前と表示される登録番号を書いてお渡しください。メールアドレスがあれば、参加証（領収書）の PDF もメールで送れます。',
    transfer: '銀行振込の入金を確認できた方を登録します（事前登録の参加費）。参加証（領収書を兼ねる PDF）つきの完了メールを送ります。',
    invite: '招待の方（参加費なし）を登録します。メールアドレスがあれば、参加証の PDF を送れます。'
  };
  function renderCats() {
    var fees = kind === 'onsite' ? ONSITE : PRE;
    $('cats').innerHTML = Object.keys(LABELS).map(function (k, i) {
      return '<label><input type="radio" name="category" value="' + k + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(LABELS[k]) + '<br><b style="margin-left:4px">' + (fees[k] ? yen(fees[k]) : '無料') + '</b></label>';
    }).join('');
    $('cat-row').hidden = kind === 'invite';
    $('kind-hint').textContent = KIND_HINT[kind];
    $('email-label').innerHTML = 'メールアドレス' + (kind === 'transfer' ? '<span class="req">必須</span>' : '');
    var f = $('reg-form');
    f.sendMail.checked = kind === 'transfer';
    $('reg-go').textContent = kind === 'onsite' ? '現金を受け取り、登録する' : '登録する';
    updateFee();
  }
  function selectedCat() { var c = document.querySelector('#cats input:checked'); return c ? c.value : ''; }
  function updateFee() {
    var fee = kind === 'invite' ? 0 : (kind === 'onsite' ? ONSITE : PRE)[selectedCat()] || 0;
    $('fee-line').textContent = kind === 'invite' ? '参加費：なし（招待）' : (kind === 'onsite' ? '受け取る参加費（現金）：' : '振込で受領済みの参加費：') + (fee ? yen(fee) : '無料');
  }
  $('cats').addEventListener('change', updateFee);
  $('kind').addEventListener('click', function (e) {
    var b = e.target.closest('[data-kind]');
    if (!b) return;
    kind = b.getAttribute('data-kind');
    document.querySelectorAll('#kind button').forEach(function (x) { x.classList.toggle('on', x === b); });
    $('reg-done').innerHTML = ''; $('reg-err').textContent = '';
    renderCats();
  });
  $('reg-form').email.addEventListener('input', function () { if (kind !== 'transfer') $('reg-form').sendMail.checked = !!this.value.trim(); });
  var allowDup = false;
  $('reg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var data = {
      kind: kind, category: selectedCat(), name: f.name.value, kana: f.kana.value, affiliation: f.affiliation.value,
      email: f.email.value, receiptName: f.receiptName.value, phone: f.phone.value, cme: f.cme.checked, sendMail: f.sendMail.checked,
      staffMemo: f.staffMemo.value, allowDup: allowDup
    };
    if (!data.name.trim() || !data.affiliation.trim()) { $('reg-err').textContent = 'お名前とご所属を入れてください。'; return; }
    var fee = kind === 'invite' ? 0 : (kind === 'onsite' ? ONSITE : PRE)[data.category] || 0;
    var msg = (kind === 'onsite' ? '当日受付' : kind === 'transfer' ? '振込の確認済み' : '招待') + 'として登録します。\n\nお名前：' + data.name + '\nご所属：' + data.affiliation +
      (kind === 'invite' ? '' : '\n区分：' + LABELS[data.category]) + '\n参加費：' + (fee ? yen(fee) + (kind === 'onsite' ? '（現金で受け取り）' : '（振込で受領済み）') : 'なし') +
      (data.sendMail ? '\n参加証の PDF をメールで送ります：' + data.email : '') + '\n\nよろしいですか？';
    if (!window.confirm(msg)) return;
    $('reg-go').disabled = true; $('reg-err').textContent = '';
    api('staff_register', data).then(function (j) {
      $('reg-go').disabled = false;
      if (!j.ok) {
        $('reg-err').textContent = j.error || '登録できませんでした。';
        if (j.dup) { allowDup = true; $('reg-go').textContent = '重複を承知で登録'; }
        return;
      }
      allowDup = false; renderCats();
      upsert(j.rec);
      var r = j.rec;
      $('reg-done').innerHTML = '<div class="done"><div style="font-weight:700;color:var(--ok)">登録しました</div><div class="id">' + esc(r.id) + '</div>' +
        '<div style="font-size:20px;font-weight:700;margin-top:6px">' + esc(r.name) + ' 様（' + esc(catShort(r.cat)) + '・' + (r.fee ? yen(r.fee) : '参加費なし') + '）</div>' +
        '<p style="line-height:1.7;margin:8px 0 0">' +
        (kind === 'onsite' ? '当日用の参加証（手書き）に、<b>お名前・ご所属・金額・登録番号</b>を書いてお渡しください。本日の受付も記録しました。' : '') +
        (j.mailed ? '<br>参加証（PDF）つきの完了メールを ' + esc(r.email) + ' に送りました。' : '') +
        (j.mailError ? '<br><b style="color:var(--ng)">メールを送れませんでした：' + esc(j.mailError) + '</b>' : '') +
        (r.cme ? '<br>認定医（更新単位）：チェック済み' : '') + '</p></div>';
      f.reset(); renderCats();
      beep(true);
    }).catch(function (err) {
      $('reg-go').disabled = false;
      $('reg-err').textContent = '通信できませんでした。電波を確認して、もう一度押してください（' + err.message + '）。\n※ 当日受付の方は、この画面を閉じずに、通信が戻ってから登録してください。';
    });
  });

  /* ---------- 集計 ---------- */
  function renderStats() {
    if (!$('stats')) return;
    var d = today();
    var ok = roster.filter(function (r) { return r.ok; });
    var dayCount = {}, cash = {}, cats = {};
    ok.forEach(function (r) {
      String(r.visits || '').split(/[、,]\s*/).forEach(function (s) { var md = s.split(' ')[0]; if (md) dayCount[md] = (dayCount[md] || 0) + 1; });
      var c = catShort(r.cat); cats[c] = cats[c] || { reg: 0, today: 0 }; cats[c].reg++; if (visitToday(r)) cats[c].today++;
      if (/当日/.test(r.via) && r.fee) { var md0 = String(r.visits || '').split(' ')[0] || '?'; cash[md0] = (cash[md0] || 0) + r.fee; }
    });
    var cme = ok.filter(function (r) { return r.cme; }).length;
    var onsite = ok.filter(function (r) { return /当日/.test(r.via); }).length;
    $('stats').innerHTML =
      stat('参加登録（支払い済み・無料）', ok.length + '名', '支払い未確認 ' + (roster.length - ok.length) + '件') +
      stat('本日（' + d + '）の来場', (dayCount[d] || 0) + '名', '') +
      stat('認定医（更新単位）', cme + '名', '') +
      stat('当日受付', onsite + '名', '本日の現金 ' + yen(cash[d] || 0));
    var days = Object.keys(dayCount).sort(function (a, b) { return new Date('2026/' + a) - new Date('2026/' + b); });
    $('stats-table').innerHTML =
      '<table class="t"><tr><th>区分</th><th>登録</th><th>本日の来場</th></tr>' + Object.keys(cats).map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="r">' + cats[c].reg + '</td><td class="r">' + cats[c].today + '</td></tr>'; }).join('') + '</table>' +
      (days.length ? '<table class="t"><tr><th>日</th><th>来場（受付した人数）</th><th>当日受付の現金</th></tr>' + days.map(function (x) { return '<tr><td>' + esc(x) + '</td><td class="r">' + dayCount[x] + '</td><td class="r">' + yen(cash[x] || 0) + '</td></tr>'; }).join('') + '</table>' : '');
  }
  function stat(k, v, s) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }

  /* ---------- タブ・設定・ログイン ---------- */
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'v-' + b.getAttribute('data-tab')); });
      if (b.getAttribute('data-tab') !== 'scan' && stream) stopCam();
      if (b.getAttribute('data-tab') === 'stats') renderStats();
    });
  });
  $('reload').addEventListener('click', function () { loadRoster(false); });
  $('settings').addEventListener('click', function () {
    $('opt-sound').checked = store('get', LS.sound) !== '0';
    $('opt-front').checked = store('get', LS.front) === '1';
    $('set-dlg').classList.add('on');
  });
  $('set-close').addEventListener('click', function () {
    store('set', LS.sound, $('opt-sound').checked ? '1' : '0');
    store('set', LS.front, $('opt-front').checked ? '1' : '0');
    useFront = $('opt-front').checked;
    $('set-dlg').classList.remove('on');
  });
  $('logout').addEventListener('click', function () {
    if (queue.length && !window.confirm('まだ送れていない記録が ' + queue.length + ' 件あります。消してもよろしいですか？')) return;
    logout(false);
  });
  function logout(byServer) {
    stopCam();
    [LS.key, LS.roster, LS.rosterAt, LS.queue].forEach(function (k) { store('del', k); });
    KEY = ''; roster = []; byId = {}; queue = [];
    $('set-dlg').classList.remove('on');
    $('app').hidden = true; $('login').hidden = false;
    $('login-err').textContent = byServer ? '合言葉が変わったか、違っています。もう一度入れてください。' : '';
  }
  function boot() {
    $('today').textContent = today();
    $('login').hidden = true; $('app').hidden = false;
    var cached = parseJSON(store('get', LS.roster));
    if (cached && cached.length) setRoster(cached, store('get', LS.rosterAt) || new Date().toISOString());
    showQueue(); renderCats(); renderStats();
    loadRoster(false);
  }
  $('login-go').addEventListener('click', function () {
    var k = $('login-key').value.trim().toUpperCase();
    if (!k) return;
    KEY = k; $('login-err').textContent = '確認中…';
    api('staff_ping').then(function (j) {
      if (!j.ok) throw new Error(j.error || '確認できませんでした。');
      store('set', LS.key, KEY);
      $('login-err').textContent = '';
      boot();
    }).catch(function (e) { KEY = ''; $('login-err').textContent = e.message; });
  });
  $('login-key').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('login-go').click(); });
  // 起動
  if (!EP) { $('login').hidden = false; $('login-err').textContent = '送信先（Apps Script）の設定がありません。事務局に連絡してください。'; }
  else if (KEY) boot();
  else $('login').hidden = false;
  // テスト用（自動テストから中身を確かめるため）
  window.__checkin = { normId: normId, handleCode: handleCode, state: function () { return { roster: roster, queue: queue }; } };
})();
