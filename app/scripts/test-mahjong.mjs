/**
 * 南京麻将 · 逻辑与界面自测（jsdom）
 * 覆盖：胡牌判定（平胡/七对/对对胡）、番型算花、144 张带花（补花）、不吃牌、发牌、出牌、AI、渲染
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

  const withHua = MJ.scoreOf({
    hand: S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5'),
    melds: [],
    selfDraw: false,
    gangDraw: false,
    wallLeft: 40,
    flowerCount: 3,
  });
  ok('每张花牌 +2 花', withHua.flowers === 40 + 6, String(withHua.flowers));
  ok('花牌单列一行番型', names(withHua).includes('花牌 ×3'), names(withHua).join('/'));

  const gangkai = MJ.scoreOf({
    hand: S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5'),
    melds: [],
    selfDraw: true,
    gangDraw: true,
    wallLeft: 4,
  });
  ok('杠上开花 +40 且海底 +10', names(gangkai).includes('杠上开花') && names(gangkai).includes('海底捞月'), names(gangkai).join('/'));

  // ---------- 2.5 胡牌权 ----------
  const pingHand = S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5');
  const pengMelds = [{ type: 'peng', tiles: ['z1', 'z1', 'z1'], from: 1 }];
  const pengHand = S('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5 p5');
  const fakeP = (n) => ({ flowers: Array.from({ length: n }, () => 'h1'), melds: pengMelds });
  ok('门清有胡牌权', MJ.hasWinRight({ flowers: [], melds: [] }, pingHand, []) === true);
  ok('碰过牌且硬花不足 4 张 → 无胡牌权', MJ.hasWinRight(fakeP(3), pengHand, pengMelds) === false);
  ok('碰过牌但亮出 4 张硬花 → 可以胡', MJ.hasWinRight(fakeP(4), pengHand, pengMelds) === true);
  ok(
    '大胡（对对胡）不受胡牌权限制',
    MJ.hasWinRight(fakeP(0), S('m1 m1 m1 m2 m2 m2 s3 s3 s3 p4 p4'), pengMelds) === true
  );

  // ---------- 3. 发牌：144 张带花 ----------
  const st = MJ.state;
  const sumBy = (fn) => st.players.reduce((a, p) => a + fn(p), 0);
  ok('四家各发 13 张主牌', [0, 1, 2, 3].every((i) => st.players[i].hand.length === 13), st.players.map((p) => p.hand.length).join('/'));
  ok(
    '牌张总数 144（108 序数 + 16 风牌 + 20 硬花）',
    st.wall.length + sumBy((p) => p.hand.length) + sumBy((p) => p.flowers.length) === 144,
    `牌墙 ${st.wall.length} + 手牌 ${sumBy((p) => p.hand.length)} + 花牌 ${sumBy((p) => p.flowers.length)}`
  );
  const huaInWall = st.wall.filter((t) => MJ.isHua(t.k)).length;
  ok(
    '20 张硬花一张不少（牌墙里或已亮出）',
    huaInWall + sumBy((p) => p.flowers.length) === MJ.HUA_TOTAL && MJ.HUA_TOTAL === 20,
    `${huaInWall + sumBy((p) => p.flowers.length)} / ${MJ.HUA_TOTAL}`
  );
  ok('硬花不会进手牌', st.players.every((p) => p.hand.every((t) => !MJ.isHua(t.k))));
  ok('中发白不在手牌牌种里（当硬花用）', st.players.every((p) => p.hand.every((t) => !/^z[567]$/.test(t.k))));
  const allTileKinds = st.wall.map((t) => t.k).concat(...st.players.map((p) => p.flowers));
  ok(
    '中发白各 4 张（12 张硬花）',
    ['f1', 'f2', 'f3'].every((k) => allTileKinds.filter((x) => x === k).length === 4),
    ['f1', 'f2', 'f3'].map((k) => k + ':' + allTileKinds.filter((x) => x === k).length).join(' ')
  );
  ok(
    '季花各 1 张',
    MJ.HUA_KINDS.every((k) => allTileKinds.filter((x) => x === k).length === 1),
    MJ.HUA_KINDS.join(',')
  );

  // 补花：往牌墙顶塞一张花牌，摸牌时应亮出并继续补
  const p1 = st.players[1];
  const hb = p1.flowers.length;
  const handBefore = p1.hand.length;
  st.wall.push(MJ.newTile('h3'));
  const drew = MJ.drawFor(p1);
  ok(
    '摸到花牌自动亮出并从牌尾补一张',
    drew && drew.k[0] !== 'h' && p1.flowers.length >= hb + 1 && p1.hand.length === handBefore + 1,
    `花 ${hb} -> ${p1.flowers.length}，手牌 ${handBefore} -> ${p1.hand.length}`
  );

  // 不吃牌
  ok('没有吃牌逻辑（南京麻将只碰不吃）', typeof MJ.chiOptions === 'undefined' && typeof window.chiOptions === 'undefined');
  ok('手牌已排序', (() => {
    const keys = st.players[0].hand.map((t) => t.k);
    const idxOf = (k) => (k[0] === 'z' ? 27 + Number(k.slice(1)) - 1 : ['m', 's', 'p'].indexOf(k[0]) * 9 + Number(k.slice(1)) - 1);
    for (let i = 1; i < keys.length; i++) if (idxOf(keys[i - 1]) > idxOf(keys[i])) return false;
    return true;
  })());

  // ---------- 4. 出牌与 AI ----------
  const me = st.players[0];
  const before = me.hand.length;
  const discardKind = me.hand[0].k;
  MJ.doDiscard(0, 0);
  ok('人类出牌后手牌 -1', me.hand.length === before - 1, `${before} -> ${me.hand.length}`);
  // 打出的牌可能被别家立刻碰走（碰牌会把牌从牌河取走），两种都算正常
  ok(
    '出牌进入牌河（或被别家碰走）',
    me.river.length === 1 || st.players.some((p, i) => i > 0 && p.melds.some((m) => m.tiles[0] === discardKind)),
    `牌河 ${me.river.length} 张`
  );

  const aiPick = MJ.pickDiscard(st.players[1]);
  ok('AI 能选出可打的手牌', aiPick >= 0 && aiPick < st.players[1].hand.length, String(aiPick));

  // ---------- 5. 页面渲染 ----------
  await wait(700);
  const doc = window.document;
  ok('牌桌四家都在', ['seatTop', 'seatLeft', 'seatRight', 'seatMe'].every((id) => doc.getElementById(id).innerHTML.length > 0));
  ok('我的牌渲染成牌面', doc.querySelectorAll('#seatMe .hand .tile').length >= 13, String(doc.querySelectorAll('#seatMe .hand .tile').length));
  ok('中央显示牌墙剩余', /牌墙剩/.test(doc.getElementById('centerBox').textContent), doc.getElementById('centerBox').textContent.replace(/\s+/g, ' ').slice(0, 40));
  ok('对手显示牌背', doc.querySelectorAll('#seatTop .back').length >= 10, String(doc.querySelectorAll('#seatTop .back').length));

  // 规则弹层
  doc.getElementById('ruleBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok('规则弹层可打开', doc.getElementById('ov').classList.contains('show') && /南京麻将 · 玩法/.test(doc.getElementById('ovPanel').textContent));
  ok('规则里有算花说明', /底 20 花/.test(doc.getElementById('ovPanel').textContent));
  ok('规则写明 144 张带花不吃', /144 张/.test(doc.getElementById('ovPanel').textContent) && /不吃/.test(doc.getElementById('ovPanel').textContent));
  ok(
    '规则写明硬花 20 张（含中发白）与胡牌权',
    /硬花 20 张/.test(doc.getElementById('ovPanel').textContent) &&
      /红中/.test(doc.getElementById('ovPanel').textContent) &&
      /胡牌权/.test(doc.getElementById('ovPanel').textContent)
  );


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
