import { describe, expect, it } from 'vitest';
import { TUTORIAL_SKIP_SHIPPED, TUTORIAL_STEPS, STEP_TEXT, advanceStep, shouldAutoStart, type TutorialSnapshot, type TutorialState } from './tutorial';

const base: TutorialSnapshot = { selectedKind: null, focusItem: false, shelfManualJob: false, amrManualJob: false, totalShipped: 0, dispatch: 0, stacks: 4 };
const st = (step: TutorialState['step'], shippedAt = 0, stacksAt = 4): TutorialState => ({ step, shippedAt, stacksAt });

describe('チュートリアルの段の進み方', () => {
  it('全部の段に文がある', () => {
    for (const s of TUTORIAL_STEPS) expect(STEP_TEXT[s].title.length).toBeGreaterThan(0);
  });
  it('1: オーダーの商品をタップ（棚が光る or 棚ロボが選ばれる）で次へ', () => {
    expect(advanceStep(st('pickOrder'), base)).toBe('pickOrder');
    expect(advanceStep(st('pickOrder'), { ...base, focusItem: true })).toBe('tapStack');
    expect(advanceStep(st('pickOrder'), { ...base, selectedKind: 'shelf' })).toBe('tapStack');
  });
  it('2: 棚ロボに手動の取り出しが入ったら次へ。3: 搬送ロボの手動指示か自動配車で次へ', () => {
    expect(advanceStep(st('tapStack'), { ...base, selectedKind: 'shelf' })).toBe('tapStack');
    expect(advanceStep(st('tapStack'), { ...base, shelfManualJob: true })).toBe('amr');
    expect(advanceStep(st('amr'), { ...base, amrManualJob: true })).toBe('ship');
    expect(advanceStep(st('amr'), { ...base, dispatch: 1 })).toBe('ship');
  });
  it('4: 出荷が増えたら次へ（開始時の出荷数と比べる）', () => {
    expect(advanceStep(st('ship', 5), { ...base, totalShipped: 5 })).toBe('ship');
    expect(advanceStep(st('ship', 5), { ...base, totalShipped: 6 })).toBe('automation');
  });
  it('5: 自動配車 Lv1、6: スタックが増えたら完了', () => {
    expect(advanceStep(st('automation'), { ...base, dispatch: 1 })).toBe('build');
    expect(advanceStep(st('build', 0, 4), { ...base, stacks: 4 })).toBe('build');
    expect(advanceStep(st('build', 0, 4), { ...base, stacks: 5 })).toBe('done');
    expect(advanceStep(st('done'), base)).toBe('done');
  });
  it('順番どおりでなくても進む: 先に出荷してしまえば 1〜3 を飛ばす', () => {
    const shipped = { ...base, totalShipped: 1 };
    expect(advanceStep(st('pickOrder'), shipped)).toBe('tapStack');
    expect(advanceStep(st('tapStack'), shipped)).toBe('amr');
    expect(advanceStep(st('amr'), shipped)).toBe('ship');
    expect(advanceStep(st('ship'), shipped)).toBe('automation');
  });
  it('自動で始める条件: 新規は常に、既存のセーブは出荷が少ないときだけ、終えていれば出さない', () => {
    expect(shouldAutoStart(false, 0, null)).toBe(true);
    expect(shouldAutoStart(true, TUTORIAL_SKIP_SHIPPED - 1, null)).toBe(true);
    expect(shouldAutoStart(true, TUTORIAL_SKIP_SHIPPED, null)).toBe(false);
    expect(shouldAutoStart(false, 0, 'done')).toBe(false);
  });
});
