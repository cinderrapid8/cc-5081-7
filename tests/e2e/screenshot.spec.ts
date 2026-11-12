import { chromium, test } from '@playwright/test';

test('capture final UI', async () => {
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
await page.goto('http://127.0.0.1:5199');
await page.waitForSelector('text=装备负载执行器');
// 构筑 3 件龙套 + 力量之戒，触发条件效果与分档展示
for (const [slot, uid] of [['头盔', 'u-dhelm'], ['胸甲', 'u-dchest'], ['护手', 'u-dgloves']] as const) {
  await page.locator('.slot-row').filter({ hasText: slot }).locator('select').selectOption(uid);
}
await page.locator('.slot-row').filter({ hasText: '饰品' }).locator('select').selectOption('u-ring');
await page.locator('.panel', { hasText: '发布链路' }).getByRole('button', { name: /发布修订/ }).click();
await page.getByRole('button', { name: /执行攻击/ }).click();
await page.waitForSelector('table tbody tr');
await page.screenshot({ path: '/tmp/final-page.png', fullPage: true });
await browser.close();
console.log('screenshot saved');
});
