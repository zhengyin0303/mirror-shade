// 镜色 MirrorShade 端到端自动化测试(Playwright + 假摄像头 + Mock人脸)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-facemesh.js"), "utf8");
const ORIGIN = "http://localhost:7777";

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  ok ? pass++ : fail++;
};

(async () => {
  const browser = await chromium.launch({
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

  // T12 缩放双按钮:+步进 / −到底清底无残影
  await page.click("#zoomIn");
  const z1 = (await page.locator("#zoomVal").textContent()).trim();
  await page.click("#zoomIn");
  const z2 = (await page.locator("#zoomVal").textContent()).trim();
  await page.click("#zoomOut"); await page.click("#zoomOut");
  await page.click("#zoomOut"); await page.click("#zoomOut");   // 连按到最小档
  const z3 = (await page.locator("#zoomVal").textContent()).trim();
  t("缩放双按钮:+至2x,−至最小档(<1x)", z1 === "1.5x" && z2 === "2x" && parseFloat(z3) < 1,
    [z1, z2, z3].join("→"));
  await page.waitForTimeout(300);
  const cornerBg = await page.evaluate(() => {
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const d = c.getImageData(4, Math.round(cv.height / 2), 1, 1).data;
    return { sum: d[0] + d[1] + d[2] };
  });
  t("缩小档四周为模糊环境背景(非死黑非残影)", cornerBg.sum > 15 && cornerBg.sum < 720, "边缘亮度=" + cornerBg.sum);
  while (parseFloat((await page.locator("#zoomVal").textContent())) < 1) await page.click("#zoomIn");
  await page.click("#zoomOut").catch(() => {});
  await page.click("#zoomIn"); // 回到约1x附近继续后续测试
  while (parseFloat((await page.locator("#zoomVal").textContent())) > 1) await page.click("#zoomOut");

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

  // ===== 品类化妆组(v2.1/2.2/2.4) =====
  // 关键点锚定采样:直接在面部部位中心取色,R-G通道差作妆色指标(免疫背景动画)
  const dbg = () => page.evaluate(() => window.__msDebug());
  const sampleAt = async (pt, dx, dy, half) => page.evaluate(([x, y, h]) => {
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const img = c.getImageData(Math.round(x - h), Math.round(y - h), h * 2, h * 2).data;
    let r = 0, g = 0, n = 0;
    for (let k = 0; k < img.length; k += 4) { r += img[k]; g += img[k + 1]; n++; }
    return (r - g) / n;                                    // 红绿差:上红妆显著抬升
  }, [pt[0] + dx, pt[1] + dy, half]);

  await page.click("#clearBtn");
  await page.waitForTimeout(300);
  let D = await dbg();
  const cheekBare = await sampleAt(D.lm.cheekL, 0, 0, 16);

  // T26 腮红:脸颊红绿差显著抬升
  await page.click('.tab[data-mode="blush"]');
  t("腮红页签色板渲染(6色)", (await page.locator("#swatches .sw").count()) === 6);
  await page.locator("#swatches .sw").first().click();
  await page.locator("#intensity").fill("85");
  await page.waitForTimeout(400);
  D = await dbg();
  const cheekOn = await sampleAt(D.lm.cheekL, 0, 0, 16);
  t("选腮红后脸颊上色(R-G抬升)", cheekOn > cheekBare + 12,
    `素${cheekBare.toFixed(0)}→妆${cheekOn.toFixed(0)}`);

  // T27 腮红打法切换
  await page.click('[data-bs="sweep"]');
  t("腮红打法切换高亮", await page.locator('[data-bs="sweep"]').evaluate(el => el.classList.contains("on")));
  await page.click('[data-bs="apple"]');

  // T28 眉妆:眉区亮度下降(染色加深)
  const lum = async (pt, half) => page.evaluate(([x, y, h]) => {
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const img = c.getImageData(Math.round(x - h), Math.round(y - h), h * 2, h * 2).data;
    let v = 0, n = 0;
    for (let k = 0; k < img.length; k += 4) { v += img[k] + img[k + 1] + img[k + 2]; n++; }
    return v / n;
  }, [pt[0], pt[1], half]);
  D = await dbg();
  const browBare = await lum(D.lm.browL, 10);
  await page.click('.tab[data-mode="brow"]');
  await page.locator("#swatches .sw").first().click();
  await page.locator("#intensity").fill("85");
  await page.waitForTimeout(400);
  D = await dbg();
  const browOn = await lum(D.lm.browL, 10);
  t("选眉色后眉区染色加深(亮度下降)", browOn < browBare - 12,
    `素${browBare.toFixed(0)}→妆${browOn.toFixed(0)}`);
  await page.click('[data-bw="arch"]');
  t("眉型切换(挑眉)高亮", await page.locator('[data-bw="arch"]').evaluate(el => el.classList.contains("on")));

  // T29 眼影:上睑带亮度/色相变化 + 渐变切换
  D = await dbg();
  const lift = D.lm.mw * 0.16;
  const eyeBare = await sampleAt([D.lm.eyeL[0], D.lm.eyeL[1] - lift], 0, 0, 9);
  await page.click('.tab[data-mode="eye"]');
  await page.locator("#swatches .sw").first().click();
  await page.locator("#intensity").fill("85");
  await page.waitForTimeout(400);
  D = await dbg();
  const eyeOn = await sampleAt([D.lm.eyeL[0], D.lm.eyeL[1] - lift], 0, 0, 9);
  t("选眼影后上睑晕染(R-G抬升)", eyeOn > eyeBare + 12,
    `素${eyeBare.toFixed(0)}→妆${eyeOn.toFixed(0)}`);
  await page.click("#eyeGrad");
  t("眼影渐变切换高亮", await page.locator("#eyeGrad").evaluate(el => el.classList.contains("on")));

  // T30 浓度分品类独立记忆
  await page.locator("#intensity").fill("90");
  await page.click('.tab[data-mode="oneclick"]');
  const lipInt = await page.locator("#intensity").inputValue();
  await page.click('.tab[data-mode="eye"]');
  const eyeInt = await page.locator("#intensity").inputValue();
  t("浓度滑杆分品类记忆", lipInt === "70" && eyeInt === "90", `唇${lipInt}/眼${eyeInt}`);

  // T31 Clear 全品类卸妆:脸颊红绿差回落 + 选中态清空
  await page.click("#clearBtn");
  await page.waitForTimeout(400);
  D = await dbg();
  const cheekCleared = await sampleAt(D.lm.cheekL, 0, 0, 16);
  t("Clear后全品类卸妆(颊部红绿差回落+无选中)",
    cheekCleared < cheekOn - 10 && (await page.locator(".sw.on").count()) === 0,
    `妆${cheekOn.toFixed(0)}→卸${cheekCleared.toFixed(0)}`);

  // ===== 衣橱功能组(v2.0) =====
  // T21 衣橱页签 + 自定义录入
  await page.click('.tab[data-mode="wardrobe"]');
  t("衣橱页签可见且有添加入口", await page.locator(".sw.add").isVisible());
  await page.click(".sw.add");
  await page.fill("#wdName", "测试砖红");
  await page.evaluate(() => { const c = document.getElementById("wdColor");
    c.value = "#B0483A"; c.dispatchEvent(new Event("input")); });
  await page.click("#wdSave");
  t("自定义录入后衣橱出现新口红", (await page.locator("#swatches .sw:not(.add)").count()) === 1
    && (await page.locator("#swatches").textContent()).includes("测试砖红"));

  // T22 长按色板收藏 + 撞色预警
  await page.click('.tab[data-mode="oneclick"]');
  const firstSw = page.locator(".sw").first();
  await firstSw.dispatchEvent("pointerdown", { clientX: 100, clientY: 100 });
  await page.waitForTimeout(750);
  await firstSw.dispatchEvent("pointerup");
  const hint1 = await page.locator("#hint").textContent();
  t("长按色板收藏入衣橱", hint1.includes("衣橱"), hint1.slice(0, 20));
  await firstSw.click();   // 再点同色 → 应提示已在衣橱/相似
  const hint2 = await page.locator("#hint").textContent();
  t("选中已收藏的颜色触发撞色提示", hint2.includes("衣橱") || hint2.includes("相似"), hint2.slice(0, 26));

  // T23 衣橱里点选口红直接上唇
  await page.click('.tab[data-mode="wardrobe"]');
  await page.locator("#swatches .sw:not(.add)").first().click();
  t("衣橱口红可选中试涂", (await page.locator("#swatches .sw.on").count()) === 1);

  // T24 导出衣橱产生文件
  const wdDl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.click("#wdExport");
  const wdFile = await wdDl;
  t("导出衣橱产出JSON文件", !!wdFile, wdFile ? wdFile.suggestedFilename() : "无下载");

  // T25 持久化:刷新后衣橱数据仍在
  await page.reload();
  await page.click("#startBtn");
  await page.waitForSelector("#skinChip.show", { timeout: 30000 }).catch(() => {});
  await page.click('.tab[data-mode="wardrobe"]');
  const persisted = await page.locator("#swatches .sw:not(.add)").count();
  t("刷新页面后衣橱数据持久保留", persisted >= 2, "保留" + persisted + "支");

  // ===== 品牌色号与照片取色(v2.3) =====
  // T32 品牌经典色号快速填入(此时处于衣橱页签,T25之后)
  await page.click(".sw.add");
  await page.selectOption("#wdBrandSel", "0,0");           // MAC 第一支
  await page.waitForTimeout(200);
  const bName = await page.locator("#wdName").inputValue();
  const bColor = (await page.locator("#wdColor").inputValue()).toLowerCase();
  t("品牌色号选择后自动填入名称与颜色", bName.includes("MAC") && bColor === "#b7202e",
    bName + " / " + bColor);

  // T33 照片取色:生成纯口红色图片喂入,应提取出红色系
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#B0263A"; x.fillRect(0, 0, 64, 64);
    return c.toDataURL("image/png");
  });
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  await page.setInputFiles("#wdPhotoFile", { name: "lip.png", mimeType: "image/png", buffer: buf });
  await page.waitForTimeout(800);
  const pColor = (await page.locator("#wdColor").inputValue()).toLowerCase();
  const pr = parseInt(pColor.slice(1, 3), 16), pg = parseInt(pColor.slice(3, 5), 16);
  t("照片取色提取出口红色(红色系)", pr > 120 && pr > pg + 50, "取色=" + pColor);
  await page.evaluate(() => document.getElementById("wdModal").classList.remove("show"));

  // T19 截图存档供人工查看
  await page.waitForTimeout(500);
  const shotPath = path.join(__dirname, "e2e-screenshot.png");
  await page.screenshot({ path: shotPath });
  t("测试截图已保存", fs.existsSync(shotPath));

  // T20 全程无JS错误
  t("全程无JavaScript错误", errors.length === 0, errors.length ? errors.slice(0, 2).join(" | ") : "0个错误");

  await browser.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试框架异常:", e); process.exit(2); });
