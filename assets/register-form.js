/* 参加登録フォーム（register-form.html）の動作。2026-11-06 追加。
 *
 * 流れ（ゼウス「リンク（画面遷移）型」・セッション発行方式）
 *   1. このページで入力 → 事務局の Google Apps Script（ウェブアプリ）へ送信
 *   2. Apps Script が登録を記録し、参加費を決めて、ゼウスからセッションIDを受け取る
 *      （ゼウスの認証キーは Apps Script の中だけにあり、このページには出てこない）
 *   3. このページが、セッションIDを付けてゼウスの決済画面へ移る（カード番号はゼウスの画面で入力）
 *
 * 安全のための決まり
 *   ・ゼウスの決済画面のURLは、下の定数に固定する。Apps Script の返事でも、URLのパラメータでも変えない。
 *   ・送信先（endpoint）は assets/register-config.js でのみ設定する。URLのパラメータでは変えられない。
 *   ・参加費はここでは「表示」だけ。実際の金額は Apps Script が区分から決める。 */
(function () {
  'use strict';

  var ZEUS_ORDER_URL = 'https://linkpt.cardservice.co.jp/cgi-bin/credit/order.cgi';
  var FEES = { MEMBER: 15000, NONMEMBER: 17000, COMED: 7000, STUDENT: 0 };
  var LABELS = {
    MEMBER: '会員',
    NONMEMBER: '非会員',
    COMED: '研修医・コメディカル',
    STUDENT: '学生（小学生〜大学院生）'
  };

  var cfg = window.JSASEM72_REG || {};
  var endpoint = (typeof cfg.endpoint === 'string') ? cfg.endpoint.trim() : '';
  if (endpoint && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    endpoint = ''; // 想定外の送信先は使わない
  }

  var form = document.getElementById('reg-form');
  if (!form) return;

  function $(id) { return document.getElementById(id); }
  var submitBtn = $('reg-submit');
  var feeBox = $('reg-fee');
  var statusBox = $('reg-status');
  var memberRow = $('row-memberno');
  var studentNote = $('reg-student-note');

  if (cfg.test && $('reg-test-banner')) $('reg-test-banner').hidden = false;
  if (!endpoint) {
    if ($('reg-not-ready')) $('reg-not-ready').hidden = false;
    submitBtn.disabled = true;
  }

  function yen(n) { return Number(n).toLocaleString('ja-JP') + '円'; }
  function category() {
    var r = form.querySelector('input[name="category"]:checked');
    return r ? r.value : '';
  }
  function field(name) {
    var el = form.elements[name];
    return el ? String(el.value || '').trim() : '';
  }
  // 全角の数字・英字・記号を半角に（電話番号・メールアドレスの入力ゆれ対策）
  function toHalf(s) {
    return String(s || '').replace(/[！-～]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/　/g, ' ');
  }

  function refresh() {
    var c = category();
    memberRow.hidden = (c !== 'MEMBER');
    studentNote.hidden = (c !== 'STUDENT');
    feeBox.textContent = '';
    if (!c) {
      feeBox.textContent = '区分を選ぶと、参加費が表示されます。';
      submitBtn.textContent = '入力内容を確認する';
      return;
    }
    var fee = FEES[c];
    var strong = document.createElement('strong');
    strong.textContent = '参加費（事前登録）：' + (fee ? yen(fee) : '無料');
    feeBox.appendChild(strong);
    feeBox.appendChild(document.createElement('br'));
    feeBox.appendChild(document.createTextNode(fee
      ? '区分「' + LABELS[c] + '」。次に進むと、決済代行会社（株式会社ゼウス）の画面でクレジットカードのお支払いをしていただきます。'
      : '区分「' + LABELS[c] + '」。お支払いはありません。当日、受付で学生証をご提示ください。'));
    submitBtn.textContent = fee ? '入力内容を確認して、決済画面へ進む' : '入力内容を確認して、登録する';
  }
  form.addEventListener('change', refresh);
  refresh();

  function setStatus(kind, lines) {
    statusBox.className = 'reg-status reg-status--' + kind;
    statusBox.textContent = '';
    (Array.isArray(lines) ? lines : [lines]).forEach(function (line, i) {
      if (i) statusBox.appendChild(document.createElement('br'));
      statusBox.appendChild(document.createTextNode(line));
    });
    statusBox.hidden = false;
    statusBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function collect() {
    var phone = toHalf(field('phone')).replace(/[^0-9]/g, '');
    return {
      category: category(),
      name: field('name'),
      kana: field('kana'),
      affiliation: field('affiliation'),
      memberNo: toHalf(field('memberNo')),
      email: toHalf(field('email')).replace(/\s/g, ''),
      email2: toHalf(field('email2')).replace(/\s/g, ''),
      phone: phone,
      receiptName: field('receiptName'),
      note: field('note'),
      consent: !!(form.elements.consent && form.elements.consent.checked),
      hp_field: field('hp_field')
    };
  }

  // メールアドレス：ゼウスで使える文字だけ（アポストロフィ不可）・50文字以内
  var EMAIL_RE = /^[A-Za-z0-9.!#$%&*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

  function validate(d) {
    var e = [];
    if (!FEES.hasOwnProperty(d.category)) e.push('参加区分を選んでください。');
    if (!d.name) e.push('お名前を入力してください。');
    else if (d.name.length > 40) e.push('お名前は40文字以内で入力してください。');
    if (!d.kana) e.push('ふりがなを入力してください。');
    else if (d.kana.length > 40) e.push('ふりがなは40文字以内で入力してください。');
    if (!d.affiliation) e.push('ご所属を入力してください（学生の方は学校名）。');
    else if (d.affiliation.length > 80) e.push('ご所属は80文字以内で入力してください。');
    if (d.memberNo && !/^[A-Za-z0-9-]{1,12}$/.test(d.memberNo)) e.push('会員番号は半角の英数字で入力してください（わからない場合は空欄で構いません）。');
    if (!d.email) e.push('メールアドレスを入力してください。');
    else if (!EMAIL_RE.test(d.email) || d.email.length > 50) e.push('メールアドレスの形式をご確認ください（半角・50文字以内）。');
    else if (d.email !== d.email2) e.push('確認用のメールアドレスが一致しません。');
    if (!d.phone) e.push('電話番号を入力してください。');
    else if (d.phone.length < 7 || d.phone.length > 15) e.push('電話番号をご確認ください（数字のみで7〜15桁）。');
    if (d.receiptName.length > 60) e.push('領収書の宛名は60文字以内で入力してください。');
    if (d.note.length > 200) e.push('連絡事項は200文字以内で入力してください。');
    if (!d.consent) e.push('「個人情報の取り扱い」と「キャンセル・返金」への同意にチェックを入れてください。');
    return e;
  }

  function confirmText(d) {
    var fee = FEES[d.category];
    return [
      '次の内容で申し込みます。よろしいですか？',
      '',
      '区分：' + LABELS[d.category],
      '参加費：' + (fee ? yen(fee) + '（このあと、決済画面でお支払い）' : '無料'),
      'お名前：' + d.name + '（' + d.kana + '）',
      'ご所属：' + d.affiliation,
      'メール：' + d.email,
      '電話：' + d.phone
    ].join('\n');
  }

  var busy = false;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy || !endpoint) return;
    var d = collect();
    var errors = validate(d);
    if (errors.length) { setStatus('error', errors); return; }
    if (!window.confirm(confirmText(d))) return;

    busy = true;
    submitBtn.disabled = true;
    setStatus('info', '送信しています。画面を閉じずに、そのままお待ちください…');

    var payload = {
      category: d.category, name: d.name, kana: d.kana, affiliation: d.affiliation,
      memberNo: d.memberNo, email: d.email, phone: d.phone,
      receiptName: d.receiptName, note: d.note, consent: d.consent, hp_field: d.hp_field
    };
    // Content-Type を付けない（text/plain）＝ Apps Script への送信で事前確認（CORS preflight）が起きない形
    fetch(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(handleResponse)
      .catch(function () {
        fail(['送信できませんでした。通信状況をご確認のうえ、もう一度お試しください。',
              'くり返しうまくいかない場合は、大会事務局（jsasem72.office@gmail.com）までご連絡ください。']);
      });
  });

  function fail(lines) {
    busy = false;
    submitBtn.disabled = false;
    setStatus('error', lines);
  }

  function handleResponse(res) {
    if (!res || res.ok !== true) {
      fail([(res && typeof res.error === 'string' && res.error) || '受け付けできませんでした。',
            'お手数ですが、入力内容をご確認のうえ、もう一度お試しください。']);
      return;
    }
    var regId = (typeof res.regId === 'string' && /^J72-[0-9]{4}-[A-Z0-9]{4}$/.test(res.regId)) ? res.regId : '';

    if (res.free) {
      location.href = 'register-complete.html?free=1' + (regId ? '&id=' + encodeURIComponent(regId) : '');
      return;
    }
    if (res.dryRun) {
      busy = false;
      submitBtn.disabled = false;
      setStatus('success', [
        '【お試しモード】登録を記録しました（登録番号：' + (regId || '—') + '、参加費：' + yen(res.money || 0) + '）。',
        '本番では、ここでゼウスの決済画面に移ります。お試しモードのため、決済は行っていません。'
      ]);
      return;
    }
    var clientip = String(res.clientip || '');
    var sid = String(res.sid || '');
    if (/^[0-9]{5}([0-9]{5})?$/.test(clientip) && /^[A-Za-z0-9]{8,64}$/.test(sid)) {
      setStatus('info', '決済画面（株式会社ゼウス）に移ります…');
      var z = $('zeus-form');
      z.setAttribute('action', ZEUS_ORDER_URL);
      z.elements.clientip.value = clientip;
      z.elements.sid.value = sid;
      z.submit();
      return;
    }
    fail(['決済画面の準備ができませんでした。時間をおいて、もう一度お試しください。',
          'くり返しうまくいかない場合は、大会事務局（jsasem72.office@gmail.com）までご連絡ください。']);
  }
})();
