/** ロボの名前の表示（1.1）: 既定の名前「棚ロボ 3」などはセーブに日本語で入っているので、英語のときは表示時に訳す。付け替えた名前はそのまま */
import { locale, tr } from '../i18n';

const DEFAULT_NAME = /^(棚ロボ|搬送ロボ|ドローン|ダブルデッカー) (\d+)$/;

export function robotName(r: { name: string }): string {
  if (locale() === 'ja') return r.name;
  const m = DEFAULT_NAME.exec(r.name);
  return m ? tr(`${m[1]} {0}`, Number(m[2])) : r.name;
}
