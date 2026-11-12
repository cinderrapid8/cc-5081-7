import { chromium, expect, test } from '@playwright/test';

const BASE = 'http://127.0.0.1:5199';

/**
 * 战斗演练：全部通过界面按钮驱动真实 store 实现。
 * 1. 初始负载发布修订 #0；
 * 2. 对假人执行攻击，记录总伤害与生效技能；
 * 3. 通过下拉框换装（龙鳞 2 件 → 4 件），发布修订 #1，同一随机种子再攻击；
 * 4. 断言：套装档位、套装来源与伤害反馈确实变化，且变化来自本次发布的真实数据。
 */
test('战斗演练：换装前后的套装效果与伤害反馈', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForSelector('text=装备负载执行器');

  const publishButton = page.locator('.panel', { hasText: '发布链路' }).getByRole('button', { name: /发布修订/ });
  const attackButton = page.getByRole('button', { name: /执行攻击/ });
  const combat = page.locator('.panel', { hasText: '战斗假人' });
  const audit = page.locator('.panel', { hasText: '增量求值审计' });

  async function attackAndRead() {
    await attackButton.click();
    const rows = combat.locator('table tbody tr');
    await expect(rows).toHaveCount(6);
    const totalText = (await combat.locator('.badge', { hasText: /总伤害/ }).first().textContent()) ?? '';
    const totalDamage = Number(totalText.replace(/\D/g, ''));
    const applied = await combat.locator('table tbody tr td:last-child').allTextContents();
    return { totalDamage, applied: applied.join(',') };
  }

  // 基线：空槽初始方案（无套装效果）
  const revision0 = await page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '当前修订' }).textContent();
  const base = await attackAndRead();
  expect(base.totalDamage).toBeGreaterThan(0);

  // 换装：龙鳞 2 件（头盔 + 胸甲），发布修订 #1
  await page.locator('.slot-row').filter({ hasText: '头盔' }).locator('select').selectOption('u-dhelm');
  await page.locator('.slot-row').filter({ hasText: '胸甲' }).locator('select').selectOption('u-dchest');
  await expect(page.locator('.badge', { hasText: '2件 / 第2档' })).toBeVisible();
  await publishButton.click();
  await expect(page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '修订 #1' })).toBeVisible();

  const dragon2 = await attackAndRead();
  expect(dragon2.totalDamage).not.toBe(base.totalDamage);
  await expect(page.locator('.panel', { hasText: '派生状态与来源审计' }).locator('.badge', { hasText: '激活至第 2 档' })).toBeVisible();
  await expect(audit.locator('.badge', { hasText: '增量与全量等价' })).toBeVisible();
  const deactivated2 = await audit
    .locator('.badge', { hasText: '增量撤销来源' })
    .textContent();
  expect(deactivated2).toContain('0');

  // 扩到 4 件：跨 2→4 档，发布修订 #2，同种子再攻击
  await page.locator('.slot-row').filter({ hasText: '护手' }).locator('select').selectOption('u-dgloves');
  await page.locator('.slot-row').filter({ hasText: '战靴' }).locator('select').selectOption('u-dboots');
  await expect(page.locator('.badge', { hasText: '4件 / 第4档' })).toBeVisible();
  await publishButton.click();
  await expect(page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '修订 #2' })).toBeVisible();

  const dragon4 = await attackAndRead();
  expect(dragon4.totalDamage).not.toBe(dragon2.totalDamage);
  await expect(page.locator('.panel', { hasText: '派生状态与来源审计' }).locator('.badge', { hasText: '激活至第 4 档' })).toBeVisible();
  await expect(page.locator('.trace', { hasText: '套装 set_dragon 档位 2 → 4' })).toBeVisible();
  await expect(audit.locator('.badge', { hasText: '增量与全量等价' })).toBeVisible();
  const tierBadge = await audit.locator('.badge', { hasText: '跨档位' }).textContent();
  expect(Number((tierBadge ?? '').replace(/\D/g, ''))).toBeGreaterThan(0);

  // 卸回 2 件：撤销第 4 档来源，发布修订 #3，伤害回落
  await page.locator('.slot-row').filter({ hasText: '护手' }).locator('select').selectOption('');
  await page.locator('.slot-row').filter({ hasText: '战靴' }).locator('select').selectOption('');
  await publishButton.click();
  await expect(page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '修订 #3' })).toBeVisible();
  const backTo2 = await attackAndRead();
  expect(backTo2.totalDamage).not.toBe(dragon4.totalDamage);
  // 来源撤销事件必须出现，证明第 4 档效果确实被撤回而不是残留
  await expect(page.locator('.trace', { hasText: '套装 set_dragon 档位 4 → 2' })).toBeVisible();
  const revoked = await page.locator('.trace', { hasText: '撤销' }).count();
  expect(revoked).toBeGreaterThan(0);
  await expect(audit.locator('.badge', { hasText: '增量撤销来源' })).toBeVisible();

  // 历史对比下拉读取修订 #1 的战斗结果，证明结果按修订真实存档
  await combat.locator('select').last().selectOption('1');
  await expect(combat.locator('.badge', { hasText: /总伤害：#3/ })).toBeVisible();

  console.log(
    JSON.stringify({
      revision0,
      base: base.totalDamage,
      dragon2: dragon2.totalDamage,
      dragon4: dragon4.totalDamage,
      backTo2: backTo2.totalDamage,
      appliedDragon4: dragon4.applied,
    }),
  );
  await browser.close();
});
