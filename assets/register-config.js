/* 参加登録フォーム（register-form.html）の設定。
   2026-11-06 追加（ゼウス「学会PAY」リンク型・セッション発行の組み込み）。

   endpoint … 事務局の Google Apps Script（ウェブアプリ）の URL（…/exec）。
              空欄のあいだは、フォームは「準備中」となり送信できません。
   test     … true のあいだは、ページの上に「テスト中」の表示を出します。
              本番の受付を始めるときに false にします。

   ※ ゼウスの認証キー（zkey）は、ここには絶対に書かないこと（公開されてしまいます）。
     認証キーは Apps Script の「スクリプト プロパティ」にだけ保存します。 */
window.JSASEM72_REG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbyfYq7sOpX36j_9ww-RM02lWMdIj37Dh-NLJyxfvUPvwrcUcg9Yab7es5z6GrznLV-O/exec',
  test: true
};
