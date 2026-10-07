<script lang="ts">
  import { asset } from "$app/paths";
  import HowToImportFromTwins from "$lib/HowToImportFromTwins.svelte";
  import HowToExportForTwins from "$lib/HowToExportForTwins.svelte";
  import Callout from "$lib/Callout.svelte";
  import Meta from "$lib/Meta.svelte";
  import Nav from "$lib/Nav.svelte";
  const title = "あきこの使い方";
  const description = "あきこの使い方やTWINSとの連携方法などの説明です。";
</script>

<Meta {title} {description} />

<Nav />

<h1>{title}</h1>

<Callout kind="warning">
  あきこは筑波大学が公式に作成したものではなく有志の学生が作成したものなので、授業一覧や単位計算に誤りがある可能性があります。
  卒業に必要な単位をあきこで管理する場合は、利用者本人の責任のもとで確認してください。
  また、不明な点がある場合は、学生支援室にて相談するようにしてください。
</Callout>

<section>
  <h2>あきこの使い方</h2>
  <p>
    自分の学類と入学年度に対応するページを開きます。
    画面幅が狭い場合は「卒業要件表」と「授業計画」を切り替えて表示します。
    ここでは履修要覧とそれぞれのマスに当てはまる授業の一覧を見ることができます。
    マスを選択すると、当てはまる授業の一覧が「当てはまる授業」の欄に表示されます。
    それぞれのマスに該当する授業だけを見ることで、履修する授業を楽に探すことができます。
  </p>
  <img src={asset("/docs/images/cell-selected.png")} />
  <p>
    「単位チェック」でTWINSの成績データを取り込み、「履修を組む」で計画する年度を選びます。
    授業の「予定に追加」ボタンを押すと、その年度の「取る授業」に入ります。パソコンではドラッグ&ドロップでも追加できます。
    「取る授業」の年度は授業ごとに変更でき、「予定から外す」で取り消せます。
    移動された授業の単位は「取る」単位として計上されます。
    必修・選択の卒業単位の合計も同じ画面で確認できます。変更はサーバーに自動保存されます。
  </p>
  <img src={asset("/docs/images/grades-imported.png")} />
  <p>
    すでに成績がついている授業は「単位取得済みの授業」、まだ履修中で成績がついていない授業は「取る授業」となります。
    単位の取得状況や合計を考慮することで、履修する授業がさらに探しやすくなります。
    「TWINSに出力」では選択中の年度の予定だけをCSVに出力します。
  </p>
</section>

<HowToImportFromTwins />

<HowToExportForTwins />
