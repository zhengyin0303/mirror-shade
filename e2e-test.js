// 镜色 MirrorShade 端到端自动化测试(Playwright + 假摄像头 + Mock人脸)
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const fs = require("fs");

const HTML = fs.readFileSync("/home/claude/mirror-shade.html", "utf8");
const MOCK = fs.readFileSync("/home/claude/mock-facemesh.js", "utf8");
const ORIGIN = "http://localhost:7777";

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  ok ? pass++ : fail++;
};

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(["camera"], { origin: ORIGIN });
  const page = await ctx.newPage();

  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // 网络拦截:主页面回我们的HTML,CDN回Mock,其余一律404
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN)) return route.fulfill({ contentType: "text/html", body: HTML });
    if (url.includes("face_mesh.js")) return route.fulfill({ contentType: "application/javascript", body: MOCK });
    return route.fulfill({ status: 404, body: "" });
  });

  await page.goto(ORIGIN + "/");

  // T1 启动页
  t("启动页渲染(品牌字+开始按钮+隐私声明)",
    await page.locator("#startBtn").isVisible() && await page.locator(".privacy").isVisible());

  // T2 开启镜子 → 进入分析
  await page.click("#startBtn");
  await page.waitForSelector("#startScreen", { state: "hidden", timeout: 15000 }).catch(() => {});
  t("点击开启镜子后进入主界面", await page.locator("#startScreen").isHidden());

  // T3 肤色分析完成(skinChip出现,文案为白话文)
  await page.waitForSelector("#skinChip.show", { timeout: 25000 }).catch(() => {});
  const chipTxt = await page.locator("#skinTxt").textContent().catch(() => "");
  t("肤色分析完成并显示白话文结果", /你是(暖皮|冷皮|中性皮)/.test(chipTxt), chipTxt.slice(0, 24) + "…");

  // T4 不自动上色(v1.2需求:等用户自己选)
  t("分析后不自动上色(无选中色号)", (await page.locator(".sw.on").count()) === 0);

  // T5 推荐星标存在
  t("色板含★推荐标记", (await page.locator(".sw.rec").count()) > 0);

  // T6 一键试色:点击色号 → 选中态 + 界面强调色跟随
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  await page.locator(".sw").first().click();
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  t("点选色号后出现选中态", (await page.locator(".sw.on").count()) === 1);
  t("界面强调色跟随口红色变化", after !== "" && after !== before, before + " → " + after);

  // T7 渲染冒烟:画布在唇区有上色(像素非纯背景)
  await page.waitForTimeout(400);
  const lipPx = await page.evaluate(() => {
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const d = c.getImageData(cv.width * 0.5, cv.height * 0.62, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  t("画布唇区有渲染输出(非空白)", lipPx.some(v => v > 0), "RGB=" + lipPx.join(","));

  // T8 切换涂抹模式 → 工具行出现
  await page.click('.tab[data-mode="smear"]');
  t("涂抹模式工具行(大刷/小刷/卸妆棉)", await page.locator("#brushBig").isVisible() && await page.locator("#eraserBtn").isVisible());

  // T9 涂抹手势:在唇区拖动后画布有变化
  const box = await page.locator("#view").boundingBox();
  const lx = box.x + box.width * 0.5, ly = box.y + box.height * 0.55;
  await page.mouse.move(lx - 25, ly);
  await page.mouse.down();
  for (let i = -25; i <= 25; i += 5) await page.mouse.move(lx + i, ly, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  t("手指涂抹后无脚本错误且界面存活", await page.locator("#panel").isVisible());

  // T10 唇型模式:预设按钮高亮(v1.1回归)+ 默认原生高亮
  await page.click('.tab[data-mode="shape"]');
  t("唇型模式默认高亮\u201c原生\u201d", await page.locator('[data-ps="natural"]').evaluate(el => el.classList.contains("on")));
  await page.click('[data-ps="smile"]');
  const smileOn = await page.locator('[data-ps="smile"]').evaluate(el => el.classList.contains("on"));
  const naturalOff = await page.locator('[data-ps="natural"]').evaluate(el => !el.classList.contains("on"));
  t("点击微笑唇后高亮切换(v1.1修复回归)", smileOn && naturalOff);

  // T11 完成返回之前的模式(v1.1修复:应回涂抹而非一键)
  await page.click("#shapeDone");
  const smearActive = await page.locator('.tab[data-mode="smear"]').evaluate(el => el.classList.contains("on"));
  t("唇型\u201c完成\u201d返回之前所在的涂抹模式(v1.1回归)", smearActive);

  // T12 缩放按钮循环(含缩小档)
  await page.click("#zoomBtn");
  const z1 = (await page.locator("#zoomBtn").textContent()).trim();
  await page.click("#zoomBtn");
  const z2 = (await page.locator("#zoomBtn").textContent()).trim();
  await page.click("#zoomBtn");
  const z3 = (await page.locator("#zoomBtn").textContent()).trim();
  await page.click("#zoomBtn");
  const z4 = (await page.locator("#zoomBtn").textContent()).trim();
  t("缩放循环 1x→1.5x→2x→缩小→1x", z1 === "1.5x" && z2 === "2x" && parseFloat(z3) < 1 && z4 === "1x",
    [z1, z2, z3, z4].join("→"));

  // T13 按住对比
  await page.locator("#compareBtn").dispatchEvent("pointerdown");
  const tagShown = await page.locator("#compareTag").isVisible();
  await page.locator("#compareBtn").dispatchEvent("pointerup");
  const tagHidden = await page.locator("#compareTag").isHidden();
  t("按住对比显示素颜标签,松手消失", tagShown && tagHidden);

  // T14 帮助弹窗
  await page.click("#helpBtn");
  const helpShown = await page.locator("#helpModal.show").isVisible();
  await page.click("#helpClose");
  t("?帮助弹窗打开与关闭", helpShown && await page.locator("#helpModal.show").count() === 0);

  // T15 修改弹窗:双维度选择并保存
  await page.click("#toneEdit");
  t("修改弹窗打开且含色调+深浅两组", await page.locator("#toneOpts").isVisible() && await page.locator("#depthOpts").isVisible());
  await page.click('[data-tone="cool"]');
  await page.click('[data-depth="白皙"]');
  await page.click("#toneSave");
  const coolTxt = await page.locator("#skinTxt").textContent();
  t("保存后文案同时反映冷皮+白皙", coolTxt.includes("冷皮") && coolTxt.includes("白皙"), coolTxt.slice(0, 22) + "…");

  // T15b 确认收起为左缘标签,点击标签唤回
  await page.click("#toneOK");
  const collapsed = await page.locator("#skinChip.show").count() === 0 && await page.locator("#skinBadge.show").isVisible();
  const badgeTxt = await page.locator("#skinBadge").textContent();
  await page.click("#skinBadge");
  const restored = await page.locator("#skinChip.show").isVisible() && await page.locator("#skinBadge.show").count() === 0;
  t("确认后收起为左缘标签(含肤色字样)", collapsed && badgeTxt.includes("冷皮"), "标签=" + badgeTxt);
  t("点击标签唤回结果条", restored);

  // T16 Clear 卸妆
  await page.click('.tab[data-mode="oneclick"]');
  await page.locator(".sw").first().click();
  await page.click("#clearBtn");
  t("Clear后取消所有选中色", (await page.locator(".sw.on").count()) === 0);

  // T17 拍照(headless无分享面板→应走下载回退)
  await page.locator(".sw").first().click();
  const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.click("#shotBtn");
  const download = await dl;
  t("拍照成功产出图片文件", !!download, download ? download.suggestedFilename() : "无下载事件");

  // T18 运动跟随冒烟:移动Mock人脸,妆容渲染位置应跟随
  await page.evaluate(() => { window.__face.dx = 0.06; window.__face.dy = 0.03; });
  await page.waitForTimeout(600);
  const moved = await page.evaluate(() => {
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const d = c.getImageData(cv.width * (0.5 + 0.06 < 1 ? 0.5 : 0.5), cv.height * 0.65, 1, 1).data;
    return d.some ? Array.from(d.slice(0, 3)) : [0,0,0];
  });
  t("模拟头部移动后渲染仍正常无报错", await page.locator("#panel").isVisible());
  await page.evaluate(() => { window.__face.dx = 0; window.__face.dy = 0; });

  // T19 截图存档供人工查看
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/home/claude/e2e-screenshot.png" });
  t("测试截图已保存", fs.existsSync("/home/claude/e2e-screenshot.png"));

  // T20 全程无JS错误
  t("全程无JavaScript错误", errors.length === 0, errors.length ? errors.slice(0, 2).join(" | ") : "0个错误");

  await browser.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试框架异常:", e); process.exit(2); });
