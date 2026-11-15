/**
 * 南京麻将 · 逻辑与界面自测（jsdom）
 * 覆盖：胡牌判定（平胡/七对/对对胡）、番型算花、发牌、出牌、AI 出牌、页面渲染
 * 用法：node scripts/test-mahjong.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'public', 'mahjong.html'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/mahjong',
  // 把动画/思考延时压短，整局跑得快一些
  beforeParse(win) {
    const orig = win.setTimeout;
    win.setTimeout = (fn, ms, ...rest) => orig(fn, Math.min(Number(ms) || 0, 30), ...rest);
  },
});
const { window } = dom;
const MJ = window.MJ;

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const S = (str) => str.split(' ');
const canWin = (kinds, m) => MJ.canWin(kinds, m);

try {
  ok('页面挂载了 MJ 调试接口', Boolean(MJ), typeof MJ);

  // ---------- 1. 胡牌判定 ----------
  ok(
    '平胡可胡',
    canWin(S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5')),
    'm123 m456 m789 s123 p55'
  );
  ok('差一张不能胡', !canWin(S('m1 m2 m3 m4 m5 m6 m7 m8 s1 s2 s3 p5 p5 p9')));
  ok('七对可胡', canWin(S('m1 m1 m2 m2 m3 m3 s4 s4 s5 s5 p7 p7 p9 p9')));
  ok('四张相同算两对（可胡）', canWin(S('m1 m1 m1 m1 m2 m2 m3 m3 s4 s4 s5 s5 p7 p7')));
  ok('对对胡可胡', canWin(S('m1 m1 m1 m2 m2 m2 s3 s3 s3 p4 p4 p4 z1 z1')));
  ok('有副露时按 11 张判断', canWin(S('m1 m2 m3 m4 m5 m6 s1 s2 s3 p5 p5'), 1));
  ok('副露数量不匹配时不能胡', !canWin(S('m1 m2 m3 m4 m5 m6 s1 s2 s3 p5 p5'), 2));
  ok('七对必须无副露', !canWin(S('m1 m1 m2 m2 m3 m3 s4 s4 s5 s5 p7 p7 p9 p9'), 1));

  // ---------- 2. 番型与花数 ----------
  const menqing = MJ.scoreOf({
    hand: S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5'),
    melds: [],
    selfDraw: false,
    gangDraw: false,
    wallLeft: 40,
  });
  const names = (r) => r.list.map((x) => x.name);
  ok('平胡底花 20 + 门清 20（三门齐全不算缺一门）', menqing.flowers === 40, String(menqing.flowers));
  ok('平胡番型列表正确', names(menqing).includes('门清') && !names(menqing).includes('缺一门'), names(menqing).join('/'));

  const qing = MJ.scoreOf({
    hand: S('m1 m2 m3 m4 m5 m6 m7 m8 m9 m1 m1 m2 m2 m3'),
    melds: [],
    selfDraw: true,
    gangDraw: false,
    wallLeft: 40,
  });
  ok('清一色 + 自摸', names(qing).includes('清一色') && names(qing).includes('自摸'), names(qing).join('/'));
  ok('清一色不重复计缺一门', !names(qing).includes('缺一门'), names(qing).join('/'));

  const hun = MJ.scoreOf({
    hand: S('m1 m2 m3 m4 m5 m6 m7 m8 m9 z1 z1 z1 z2 z2'),
    melds: [],
    selfDraw: false,
    gangDraw: false,
    wallLeft: 40,
  });
  ok('混一色（一门数牌 + 字牌）', names(hun).includes('混一色'), names(hun).join('/'));

  const qidui = MJ.scoreOf({
    hand: S('m1 m1 m2 m2 m3 m3 s4 s4 s5 s5 p7 p7 p9 p9'),
    melds: [],
    selfDraw: false,
    gangDraw: false,
    wallLeft: 40,
  });
  ok('七对 80 花且不计门清', names(qidui).includes('七对') && !names(qidui).includes('门清'), names(qidui).join('/'));
  ok('七对合计 20+80', qidui.flowers === 100, String(qidui.flowers));

  const dui = MJ.scoreOf({
    hand: S('m1 m1 m1 m2 m2 m2 s3 s3 s3 p4 p4 p4 z1 z1'),
    melds: [],
    selfDraw: false,
    gangDraw: false,
    wallLeft: 40,
  });
  ok('对对胡 +40', names(dui).includes('对对胡'), names(dui).join('/'));

  const gangkai = MJ.scoreOf({
    hand: S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5'),
    melds: [],
    selfDraw: true,
    gangDraw: true,
    wallLeft: 4,
  });
  ok('杠上开花 +40 且海底 +10', names(gangkai).includes('杠上开花') && names(gangkai).includes('海底捞月'), names(gangkai).join('/'));

  // ---------- 3. 发牌 ----------
  const st = MJ.state;
  ok('四家各发 13 张（庄家多摸一张）', [0, 1, 2, 3].every((i) => st.players[i].hand.length >= 13), st.players.map((p) => p.hand.length).join('/'));
  ok('牌墙数量正确', st.wall.length + st.players.reduce((s2, p) => s2 + p.hand.length, 0) === 136, String(st.wall.length));
  ok('手牌已排序', (() => {
    const keys = st.players[0].hand.map((t) => t.k);
    const idxOf = (k) => (k[0] === 'z' ? 27 + Number(k.slice(1)) - 1 : ['m', 's', 'p'].indexOf(k[0]) * 9 + Number(k.slice(1)) - 1);
    for (let i = 1; i < keys.length; i++) if (idxOf(keys[i - 1]) > idxOf(keys[i])) return false;
    return true;
  })());

  // ---------- 4. 出牌与 AI ----------
  const me = st.players[0];
  const before = me.hand.length;
  MJ.doDiscard(0, 0);
  ok('人类出牌后手牌 -1', me.hand.length === before - 1, `${before} -> ${me.hand.length}`);
  ok('出牌进入牌河', me.river.length === 1, String(me.river.length));

  const aiPick = MJ.pickDiscard(st.players[1]);
  ok('AI 能选出可打的手牌', aiPick >= 0 && aiPick < st.players[1].hand.length, String(aiPick));

  // ---------- 5. 页面渲染 ----------
  await wait(700);
  const doc = window.document;
  ok('牌桌四家都在', ['seatTop', 'seatLeft', 'seatRight', 'seatMe'].every((id) => doc.getElementById(id).innerHTML.length > 0));
  ok('我的牌渲染成牌面', doc.querySelectorAll('#seatMe .hand .tile').length >= 13, String(doc.querySelectorAll('#seatMe .hand .tile').length));
  ok('中央显示牌墙剩余', /牌墙剩/.test(doc.getElementById('centerBox').textContent), doc.getElementById('centerBox').textContent.replace(/\s+/g, ' ').slice(0, 40));
  ok('对手显示牌背', doc.querySelectorAll('#seatTop .back').length >= 13, String(doc.querySelectorAll('#seatTop .back').length));

  // 规则弹层
  doc.getElementById('ruleBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok('规则弹层可打开', doc.getElementById('ov').classList.contains('show') && /南京麻将 · 玩法/.test(doc.getElementById('ovPanel').textContent));
  ok('规则里有算花说明', /底 20 花/.test(doc.getElementById('ovPanel').textContent));

  // 吃牌组合
  const chi = MJ.chiOptions(0, 'm5');
  ok('吃牌组合返回数组', Array.isArray(chi), JSON.stringify(chi));

  // ---------- 6. 整局自动跑完（检验回合流不会卡死） ----------
  dom.window.document.getElementById('ov').classList.remove('show');
  const t0 = Date.now();
  let guard = 0;
  while (!MJ.state.over && Date.now() - t0 < 60000 && guard++ < 4000) {
    const ph = MJ.state.phase;
    if (ph === 'human-claim') {
      const pass = doc.querySelector('[data-act="do-pass"]');
      if (pass) pass.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    } else if (ph === 'human-discard' || ph === 'human-self') {
      MJ.doDiscard(0, 0);
    }
    await wait(5);
  }
  ok('一局能走到结束（胡牌或荒庄）', MJ.state.over, `阶段=${MJ.state.phase} 牌墙=${MJ.state.wall.length} 用时=${Date.now() - t0}ms`);
  ok('结束后总分守恒', MJ.state.players.reduce((a, p) => a + p.score, 0) === 0, MJ.state.players.map((p) => p.score).join('/'));
} catch (e) {
  fails.push('异常：' + e.message);
  console.log('✘ 异常：' + e.message);
}

console.log(`\n结果：${pass}/${pass + fails.length} 通过`);
if (fails.length) {
  console.log('失败项：' + fails.join('、'));
  process.exit(1);
}
process.exit(0);
