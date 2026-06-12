// 镜色 MirrorShade v3.0 端到端自动化测试(Playwright + 假摄像头 + Mock人脸)
// 方法:部位锚定采样(__msDebug) + 色彩方向断言;肤色分析完成后冻结视频帧,
//       背景静止使所有像素差值断言确定化(mock 关键点不依赖视频内容)。
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

  /* ---------- 采样与交互工具 ---------- */
  const dbg = () => page.evaluate(() => window.__msDebug());
  const rgAt = (x, y, h) => page.evaluate(([X, Y, H2]) => {        // 红绿差:上红妆显著抬升
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const d = c.getImageData(Math.round(X - H2), Math.round(Y - H2), H2 * 2, H2 * 2).data;
    let r = 0, g = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; n++; }
    return (r - g) / n;
  }, [x, y, h]);
  const lumAt = (x, y, h) => page.evaluate(([X, Y, H2]) => {       // 亮度:染眉加深/质地提亮
    const cv = document.getElementById("view"), c = cv.getContext("2d");
    const d = c.getImageData(Math.round(X - H2), Math.round(Y - H2), H2 * 2, H2 * 2).data;
    let v = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) { v += d[k] + d[k + 1] + d[k + 2]; n++; }
    return v / n;
  }, [x, y, h]);
  const toClient = (cx2, cy2) => page.evaluate(([X, Y]) => {
    const cv = document.getElementById("view"), r = cv.getBoundingClientRect();
    const s = r.width / cv.width;
    return [r.left + X * s, r.top + Y * s];
  }, [cx2, cy2]);
  const drag = async pts => {                                      // 画布坐标系内拖动一笔
    const [sx, sy] = await toClient(pts[0][0], pts[0][1]);
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (const [X, Y] of pts.slice(1)) {
      const [mx, my] = await toClient(X, Y);
      await page.mouse.move(mx, my, { steps: 4 });
    }
    await page.mouse.up();
  };
  const rub = async (cx2, cy2, half) => {                          // 来回涂三笔
    for (let k = 0; k < 3; k++)
      await drag([[cx2 - half, cy2], [cx2 + half, cy2], [cx2 - half, cy2]]);
    await page.waitForTimeout(280);
  };
  const longPress = async sel => {
    await page.locator(sel).dispatchEvent("pointerdown");
    await page.waitForTimeout(700);
    await page.locator(sel).dispatchEvent("pointerup");
    await page.waitForTimeout(280);
  };
  // 各品类锚点采样(冻结帧下确定):唇=下唇带,腮红=左颧,眉=左眉峰(亮度),眼=上睑带
  let D = null;
  const refresh = async () => { D = await dbg(); };
  const lipRG  = async () => rgAt(D.lm.lipB[0], D.lm.lipB[1], 6);
  const cheekRG = async () => rgAt(D.lm.cheekL[0], D.lm.cheekL[1], 8);
  const browLum = async () => lumAt(D.lm.browL[0], D.lm.browL[1], 10);
  const eyeRG  = async () => rgAt(D.lm.eyeL[0], D.lm.eyeL[1] - D.lm.mw * 0.16, 7);

  await page.goto(ORIGIN + "/");

  /* ========== 启动与肤色分析 ========== */
  t("启动页渲染(品牌字+开始按钮+隐私声明+v3.0标记)",
    await page.locator("#startBtn").isVisible() && await page.locator(".privacy").isVisible()
    && (await page.locator("#startScreen").textContent()).includes("v3.0"));

  await page.click("#startBtn");
  await page.waitForSelector("#startScreen", { state: "hidden", timeout: 15000 }).catch(() => {});
  t("点击开启镜子后进入主界面", await page.locator("#startScreen").isHidden());

  await page.waitForSelector("#skinChip.show", { timeout: 25000 }).catch(() => {});
  const chipTxt = await page.locator("#skinTxt").textContent().catch(() => "");
  t("肤色分析完成并显示白话文结果", /你是(暖皮|冷皮|中性皮)/.test(chipTxt), chipTxt.slice(0, 24) + "…");
  t("分析后不自动上色(无选中色号)", (await page.locator(".sw.on").count()) === 0);
  t("色板含★推荐标记", (await page.locator(".sw.rec").count()) > 0);

  // 分析完成,冻结视频帧:此后所有像素断言确定化
  await page.evaluate(() => document.querySelector("video").pause());
  await page.waitForTimeout(200);
  await refresh();

  /* ========== 一级页签结构 ========== */
  const catTabs = await page.locator(".tab").allTextContents();
  t("一级页签固定五品类", JSON.stringify(catTabs) === JSON.stringify(["唇妆", "腮红", "眉妆", "眼影", "衣橱"]),
    catTabs.join("/"));

  /* ========== 唇妆:一键试色 ========== */
  const lipModes = await page.locator("#tools [data-m]").allTextContents();
  t("唇妆二级模式齐全(一键/亲手/唇型)",
    JSON.stringify(lipModes) === JSON.stringify(["一键试色", "亲手上妆", "唇型"]), lipModes.join("/"));

  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  const lipBare0 = await lipRG();
  await page.locator(".sw").first().click();
  await page.waitForTimeout(380);
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  t("点选色号后出现选中态", (await page.locator(".sw.on").count()) === 1);
  t("界面强调色跟随口红色变化", after !== "" && after !== before, before + " → " + after);
  const lipOn0 = await lipRG();
  t("一键试色下唇带上色(R-G抬升)", lipOn0 > lipBare0 + 30, `素${lipBare0.toFixed(0)}→妆${lipOn0.toFixed(0)}`);

  /* ========== 唇妆:亲手上妆(涂抹层) ========== */
  await page.click("#clearBtn");                                  // 清唇,从空涂层开始
  await page.waitForTimeout(280);
  await page.click('[data-m="smear"]');
  t("亲手上妆工具行(大刷/小刷/卸妆棉)",
    await page.locator("#brushBig").isVisible() && await page.locator("#eraserBtn").isVisible());
  await page.locator(".sw").first().click();                      // 涂抹模式下选色:不自动铺满
  await page.waitForTimeout(200);
  const lipSm0 = await lipRG();
  await rub(D.lm.lipB[0], D.lm.lipB[1], 30);                      // 沿下唇带来回涂
  const lipSm1 = await lipRG();
  t("手指涂抹唇部上色(R-G抬升)", lipSm1 > lipSm0 + 12, `${lipSm0.toFixed(0)}→${lipSm1.toFixed(0)}`);

  /* ========== 唇妆:唇型 ========== */
  await page.click('[data-m="shape"]');
  t("唇型模式默认高亮“原生”", await page.locator('[data-ps="natural"]').evaluate(el => el.classList.contains("on")));
  await page.click('[data-ps="smile"]');
  const smileOn = await page.locator('[data-ps="smile"]').evaluate(el => el.classList.contains("on"));
  const naturalOff = await page.locator('[data-ps="natural"]').evaluate(el => !el.classList.contains("on"));
  t("点击微笑唇后高亮切换", smileOn && naturalOff);
  await page.click("#shapeDone");
  t("唇型“完成”返回之前的亲手上妆模式",
    await page.locator('[data-m="smear"]').evaluate(el => el.classList.contains("on")));
  await page.click('[data-m="oneclick"]');                        // 回一键,后续测试以整唇为基

  /* ========== 缩放 ========== */
  await page.click("#zoomIn");
  const z1 = (await page.locator("#zoomVal").textContent()).trim();
  await page.click("#zoomIn");
  const z2 = (await page.locator("#zoomVal").textContent()).trim();
  await page.click("#zoomOut"); await page.click("#zoomOut");
  await page.click("#zoomOut"); await page.click("#zoomOut");
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
  while (parseFloat((await page.locator("#zoomVal").textContent())) > 1) await page.click("#zoomOut");
  await page.waitForTimeout(250);
  await refresh();

  /* ========== 四品类全部上妆(后续作用域测试的基台) ========== */
  // 唇已有色(一键);腮红/眉/眼逐一上色,浓度85增强对比
  const bareCheek = await cheekRG(), bareBrow = await browLum(), bareEye = await eyeRG();
  await page.click('.tab[data-cat="blush"]');
  t("腮红页签色板渲染(6色)", (await page.locator("#swatches .sw").count()) === 6);
  await page.locator("#swatches .sw").first().click();
  await page.locator("#intensity").fill("85");
  await page.waitForTimeout(380);
  const cheekOn = await cheekRG();
  t("选腮红后脸颊上色(R-G抬升)", cheekOn > bareCheek + 12, `素${bareCheek.toFixed(0)}→妆${cheekOn.toFixed(0)}`);
  await page.click('[data-bs="sweep"]');
  t("腮红打法切换高亮", await page.locator('[data-bs="sweep"]').evaluate(el => el.classList.contains("on")));
  await page.click('[data-bs="apple"]');

  await page.click('.tab[data-cat="brow"]');
  await page.locator("#swatches .sw").first().click();
  await page.locator("#intensity").fill("85");
  await page.waitForTimeout(380);
  const browOn = await browLum();
  t("选眉色后眉区染色加深(亮度下降)", browOn < bareBrow - 12, `素${bareBrow.toFixed(0)}→妆${browOn.toFixed(0)}`);
  await page.click('[data-bw="arch"]');
  t("眉型切换(挑眉)高亮", await page.locator('[data-bw="arch"]').evaluate(el => el.classList.contains("on")));
  await page.click('[data-bw="natural"]');

  await page.click('.tab[data-cat="eye"]');
  await page.locator("#swatches .sw").first().click();
  await page.locator("#intensity").fill("85");
  await page.waitForTimeout(380);
  const eyeOn = await eyeRG();
  t("选眼影后上睑晕染(R-G抬升)", eyeOn > bareEye + 12, `素${bareEye.toFixed(0)}→妆${eyeOn.toFixed(0)}`);
  await page.click("#eyeGrad");
  t("眼影渐变切换高亮", await page.locator("#eyeGrad").evaluate(el => el.classList.contains("on")));
  await page.click("#eyeSolid");

  /* ========== 按住对比:品类作用域(四品类逐一) ========== */
  const cmpDown = () => page.locator("#compareBtn").dispatchEvent("pointerdown");
  const cmpUp = () => page.locator("#compareBtn").dispatchEvent("pointerup");
  // 唇
  await page.click('.tab[data-cat="lip"]');
  const lipNow = await lipRG();
  await cmpDown(); await page.waitForTimeout(280);
  const lipCmp = await lipRG(), cheekDuringLip = await cheekRG();
  const tagLip = await page.locator("#compareTag").textContent();
  await cmpUp(); await page.waitForTimeout(280);
  t("唇妆对比:仅唇妆消失", lipCmp < lipNow - 25, `${lipNow.toFixed(0)}→${lipCmp.toFixed(0)}`);
  t("唇妆对比:腮红保留", cheekDuringLip > bareCheek + 10, `颊R-G=${cheekDuringLip.toFixed(0)}`);
  t("对比标签显示品类(无唇妆)", tagLip.includes("唇妆"), tagLip);
  t("松手唇妆恢复", (await lipRG()) > lipNow - 10);
  // 腮红
  await page.click('.tab[data-cat="blush"]');
  await cmpDown(); await page.waitForTimeout(280);
  const cheekCmp = await cheekRG(), lipDuringBlush = await lipRG();
  await cmpUp(); await page.waitForTimeout(280);
  t("腮红对比:仅腮红消失", cheekCmp < cheekOn - 10, `${cheekOn.toFixed(0)}→${cheekCmp.toFixed(0)}`);
  t("腮红对比:唇妆保留", lipDuringBlush > lipNow - 10, `唇R-G=${lipDuringBlush.toFixed(0)}`);
  // 眉
  await page.click('.tab[data-cat="brow"]');
  await cmpDown(); await page.waitForTimeout(280);
  const browCmp = await browLum();
  await cmpUp(); await page.waitForTimeout(280);
  t("眉妆对比:仅眉妆消失(亮度回升)", browCmp > browOn + 8, `${browOn.toFixed(0)}→${browCmp.toFixed(0)}`);
  // 眼
  await page.click('.tab[data-cat="eye"]');
  await cmpDown(); await page.waitForTimeout(280);
  const eyeCmp = await eyeRG(), lipDuringEye = await lipRG();
  await cmpUp(); await page.waitForTimeout(280);
  t("眼影对比:仅眼影消失", eyeCmp < eyeOn - 8, `${eyeOn.toFixed(0)}→${eyeCmp.toFixed(0)}`);
  t("眼影对比:唇妆保留", lipDuringEye > lipNow - 10, `唇R-G=${lipDuringEye.toFixed(0)}`);

  /* ========== 帮助与肤色修改 ========== */
  await page.click("#helpBtn");
  const helpShown = await page.locator("#helpModal.show").isVisible();
  await page.click("#helpClose");
  t("?帮助弹窗打开与关闭", helpShown && await page.locator("#helpModal.show").count() === 0);

  await page.click('.tab[data-cat="lip"]');
  await page.click("#toneEdit");
  t("修改弹窗打开且含色调+深浅两组", await page.locator("#toneOpts").isVisible() && await page.locator("#depthOpts").isVisible());
  await page.click('[data-tone="cool"]');
  await page.click('[data-depth="白皙"]');
  await page.click("#toneSave");
  const coolTxt = await page.locator("#skinTxt").textContent();
  t("保存后文案同时反映冷皮+白皙", coolTxt.includes("冷皮") && coolTxt.includes("白皙"), coolTxt.slice(0, 22) + "…");
  await page.click("#toneOK");
  const collapsed = await page.locator("#skinChip.show").count() === 0 && await page.locator("#skinBadge.show").isVisible();
  const badgeTxt = await page.locator("#skinBadge").textContent();
  await page.click("#skinBadge");
  const restored = await page.locator("#skinChip.show").isVisible() && await page.locator("#skinBadge.show").count() === 0;
  t("确认后收起为左缘标签(含肤色字样)", collapsed && badgeTxt.includes("冷皮"), "标签=" + badgeTxt);
  t("点击标签唤回结果条", restored);

  /* ========== Clear:品类作用域(四品类逐一)+ 长按全卸 ========== */
  // 色板重排(肤色修改)后唇色选中保持;此刻四品类仍全有妆
  await page.click('.tab[data-cat="blush"]');
  await page.click("#clearBtn");
  await page.waitForTimeout(300);
  const cheekCleared = await cheekRG(), lipKept = await lipRG();
  const hintBlush = await page.locator("#hint").textContent();
  t("腮红页签Clear:腮红消失", cheekCleared < cheekOn - 10, `${cheekOn.toFixed(0)}→${cheekCleared.toFixed(0)}`);
  t("腮红页签Clear:唇妆原样保留", lipKept > lipNow - 10, `唇R-G=${lipKept.toFixed(0)}`);
  t("Clear提示带品类名", hintBlush.includes("已卸除腮红"), hintBlush);
  await page.click('.tab[data-cat="brow"]');
  await page.click("#clearBtn");
  await page.waitForTimeout(300);
  t("眉妆页签Clear:眉妆消失(亮度回升)", (await browLum()) > browOn + 8);
  await page.click('.tab[data-cat="eye"]');
  await page.click("#clearBtn");
  await page.waitForTimeout(300);
  t("眼影页签Clear:眼影消失", (await eyeRG()) < eyeOn - 8);
  await page.click('.tab[data-cat="lip"]');
  await page.click("#clearBtn");
  await page.waitForTimeout(300);
  t("唇妆页签Clear:唇妆消失", (await lipRG()) < lipNow - 25);

  // 重新全品类上妆 → 长按 Clear 全卸
  await page.locator(".sw").first().click();
  await page.click('.tab[data-cat="blush"]'); await page.locator("#swatches .sw").first().click();
  await page.click('.tab[data-cat="eye"]'); await page.locator("#swatches .sw").first().click();
  await page.waitForTimeout(380);
  await longPress("#clearBtn");
  const hintAll = await page.locator("#hint").textContent();
  const lipAfterAll = await lipRG(), cheekAfterAll = await cheekRG(), eyeAfterAll = await eyeRG();
  t("长按Clear全品类卸妆(唇·颊·眼像素全回落)",
    lipAfterAll < lipNow - 25 && cheekAfterAll < cheekOn - 10 && eyeAfterAll < eyeOn - 8,
    `唇${lipAfterAll.toFixed(0)} 颊${cheekAfterAll.toFixed(0)} 眼${eyeAfterAll.toFixed(0)}`);
  t("长按Clear提示全卸文案", hintAll.includes("已全部卸妆"), hintAll);
  t("长按Clear后无选中色", (await page.locator("#swatches .sw.on").count()) === 0);

  /* ========== 拍照与运动跟随 ========== */
  await page.click('.tab[data-cat="lip"]');
  await page.locator(".sw").first().click();
  const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.click("#shotBtn");
  const download = await dl;
  t("拍照成功产出图片文件", !!download, download ? download.suggestedFilename() : "无下载事件");

  await page.evaluate(() => { window.__face.dx = 0.06; window.__face.dy = 0.03; });
  await page.waitForTimeout(600);
  t("模拟头部移动后渲染仍正常无报错", await page.locator("#panel").isVisible());
  await page.evaluate(() => { window.__face.dx = 0; window.__face.dy = 0; });
  await page.waitForTimeout(400);
  await refresh();

  /* ========== 浓度分品类记忆 ========== */
  await page.click('.tab[data-cat="eye"]');
  await page.locator("#intensity").fill("90");
  await page.click('.tab[data-cat="lip"]');
  const lipInt = await page.locator("#intensity").inputValue();
  await page.click('.tab[data-cat="eye"]');
  const eyeInt = await page.locator("#intensity").inputValue();
  t("浓度滑杆分品类记忆", lipInt === "70" && eyeInt === "90", `唇${lipInt}/眼${eyeInt}`);

  /* ========== 亲手上妆扩展:腮红 ========== */
  await page.click('.tab[data-cat="blush"]');
  const blushModes = await page.locator("#tools [data-m]").allTextContents();
  t("腮红二级模式(一键/亲手)", JSON.stringify(blushModes) === JSON.stringify(["一键上妆", "亲手上妆"]),
    blushModes.join("/"));
  await page.click('[data-m="smear"]');
  t("腮红手涂工具行(大刷/小刷/卸妆棉)",
    await page.locator("#brushBig").isVisible() && await page.locator("#eraserBtn").isVisible());
  await page.locator("#swatches .sw").first().click();
  await page.waitForTimeout(200);
  const ckL = D.lm.cheekL;
  const cheekSm0 = await cheekRG();
  await rub(ckL[0], ckL[1], 30);
  const cheekSm1 = await cheekRG();
  t("腮红手涂上色(R-G抬升)", cheekSm1 > cheekSm0 + 10, `${cheekSm0.toFixed(0)}→${cheekSm1.toFixed(0)}`);

  const forePt = [D.W * 0.5, D.H * 0.18];
  const foreBefore = await rgAt(forePt[0], forePt[1], 8);
  await drag([[forePt[0] - 30, forePt[1]], [forePt[0] + 30, forePt[1]]]);
  await page.waitForTimeout(280);
  const foreAfter = await rgAt(forePt[0], forePt[1], 8);
  t("腮红涂出界(额头)自动裁掉", Math.abs(foreAfter - foreBefore) < 6,
    `${foreBefore.toFixed(0)}→${foreAfter.toFixed(0)}`);

  await page.click("#eraserBtn");
  for (let k = 0; k < 5; k++) await rub(ckL[0], ckL[1], 32);
  const cheekErased = await cheekRG();
  t("腮红卸妆棉局部擦除", cheekErased < cheekSm1 - 8, `${cheekSm1.toFixed(0)}→${cheekErased.toFixed(0)}`);
  await page.click("#eraserBtn");

  await rub(ckL[0], ckL[1], 30);                                  // 重涂
  await page.click('[data-m="oneclick"]');
  await page.locator("#swatches .sw").nth(1).click();             // 一键点色:应清手涂层
  await page.waitForTimeout(200);
  await page.click('[data-m="smear"]');
  await page.waitForTimeout(280);
  const cheekExcl = await cheekRG();
  t("一键点色清空该品类手涂层(互斥)", cheekExcl < cheekSm1 - 8, `手涂${cheekSm1.toFixed(0)} vs 现${cheekExcl.toFixed(0)}`);

  await rub(ckL[0], ckL[1], 30);                                  // 再涂,测转头跟随
  await page.evaluate(() => { window.__face.dx = 0.05; window.__face.dy = 0.02; });
  await page.waitForTimeout(600);
  await refresh();
  const cheekMoved = await cheekRG();                             // 锚点已随头移动
  t("转头后手涂腮红跟随不错位", cheekMoved > cheekSm0 + 8, `新位置R-G=${cheekMoved.toFixed(0)}`);
  await page.evaluate(() => { window.__face.dx = 0; window.__face.dy = 0; });
  await page.waitForTimeout(500);
  await refresh();

  /* ========== 亲手上妆扩展:眼影 ========== */
  await page.click('.tab[data-cat="eye"]');
  const eyeModes = await page.locator("#tools [data-m]").allTextContents();
  t("眼影二级模式(一键/亲手)", JSON.stringify(eyeModes) === JSON.stringify(["一键上妆", "亲手上妆"]),
    eyeModes.join("/"));
  await page.click('[data-m="smear"]');
  await page.locator("#swatches .sw").first().click();
  await page.waitForTimeout(200);
  const eyePt = [D.lm.eyeL[0], D.lm.eyeL[1] - D.lm.mw * 0.16];
  const eyeSm0 = await eyeRG();
  await rub(eyePt[0], eyePt[1], 25);
  const eyeSm1 = await eyeRG();
  t("眼影手涂上色(R-G抬升)", eyeSm1 > eyeSm0 + 8, `${eyeSm0.toFixed(0)}→${eyeSm1.toFixed(0)}`);
  await page.click('[data-m="oneclick"]');
  await page.locator("#swatches .sw").first().click();            // 回一键并清手涂层

  /* ========== 质地:标签 / 提亮 / 记忆 / 眉妆隐藏 ========== */
  t("眼影质地行=哑光/珠光", (await page.locator("#texSeg").textContent()) === "哑光珠光");
  await page.waitForTimeout(300);
  await refresh();
  const pearlPt = [D.lm.eyeL[0], D.lm.eyeL[1] - D.lm.mw * 0.14];
  const eyeMatteLum = await lumAt(pearlPt[0], pearlPt[1], 7);
  await page.click('#texSeg [data-tex="pearl"]');
  await page.waitForTimeout(300);
  const eyePearlLum = await lumAt(pearlPt[0], pearlPt[1], 7);
  t("珠光较哑光肉眼可辨(亮度抬升)", eyePearlLum > eyeMatteLum + 8,
    `${eyeMatteLum.toFixed(0)}→${eyePearlLum.toFixed(0)}`);

  await page.click('.tab[data-cat="blush"]');
  t("腮红质地行=哑光/微闪", (await page.locator("#texSeg").textContent()) === "哑光微闪");
  await page.click('[data-m="oneclick"]');
  await page.locator("#swatches .sw").first().click();
  await page.waitForTimeout(300);
  const blushMatteLum = await lumAt(D.lm.cheekL[0], D.lm.cheekL[1], 8);
  await page.click('#texSeg [data-tex="shimmer"]');
  await page.waitForTimeout(300);
  const blushShimLum = await lumAt(D.lm.cheekL[0], D.lm.cheekL[1], 8);
  t("微闪较哑光肉眼可辨(亮度抬升)", blushShimLum > blushMatteLum + 6,
    `${blushMatteLum.toFixed(0)}→${blushShimLum.toFixed(0)}`);

  await page.click('.tab[data-cat="lip"]');
  const lipTexMatte = await page.locator('#texSeg [data-tex="matte"]').evaluate(el => el.classList.contains("on"));
  await page.click('.tab[data-cat="blush"]');
  const blushTexMem = await page.locator('#texSeg [data-tex="shimmer"]').evaluate(el => el.classList.contains("on"));
  await page.click('.tab[data-cat="eye"]');
  const eyeTexMem = await page.locator('#texSeg [data-tex="pearl"]').evaluate(el => el.classList.contains("on"));
  t("质地分品类记忆(唇哑光/腮红微闪/眼影珠光)", lipTexMatte && blushTexMem && eyeTexMem);
  await page.click('.tab[data-cat="brow"]');
  t("眉妆页签:质地行整体隐藏", await page.locator("#texSeg").isHidden());
  t("眉妆页签:无手涂入口、无二级模式", (await page.locator("#tools [data-m]").count()) === 0
    && (await page.locator("#brushBig").count()) === 0);

  /* ========== 衣橱(维持v2.4 + 应用到唇妆) ========== */
  await page.click('.tab[data-cat="wardrobe"]');
  t("衣橱页签可见且有添加入口", await page.locator(".sw.add").isVisible());
  await page.click(".sw.add");
  await page.fill("#wdName", "测试砖红");
  await page.evaluate(() => { const c = document.getElementById("wdColor");
    c.value = "#B0483A"; c.dispatchEvent(new Event("input")); });
  await page.click("#wdSave");
  t("自定义录入后衣橱出现新口红", (await page.locator("#swatches .sw:not(.add)").count()) === 1
    && (await page.locator("#swatches").textContent()).includes("测试砖红"));

  await page.click('.tab[data-cat="lip"]');
  const firstSw = page.locator(".sw").first();
  await firstSw.dispatchEvent("pointerdown", { clientX: 100, clientY: 100 });
  await page.waitForTimeout(750);
  await firstSw.dispatchEvent("pointerup");
  const hint1 = await page.locator("#hint").textContent();
  t("长按色板收藏入衣橱", hint1.includes("衣橱"), hint1.slice(0, 20));
  await firstSw.click();
  const hint2 = await page.locator("#hint").textContent();
  t("选中已收藏的颜色触发撞色提示", hint2.includes("衣橱") || hint2.includes("相似"), hint2.slice(0, 26));

  await page.click('.tab[data-cat="wardrobe"]');
  await page.locator("#swatches .sw:not(.add)").first().click();
  const accentNow = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  t("衣橱点选口红应用到唇妆(选中+强调色)", (await page.locator("#swatches .sw.on").count()) === 1
    && accentNow.toLowerCase() === "#b0483a", accentNow);

  const wdDl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.click("#wdExport");
  const wdFile = await wdDl;
  t("导出衣橱产出JSON文件", !!wdFile, wdFile ? wdFile.suggestedFilename() : "无下载");

  await page.reload();
  await page.click("#startBtn");
  await page.waitForSelector("#skinChip.show", { timeout: 30000 }).catch(() => {});
  await page.click('.tab[data-cat="wardrobe"]');
  const persisted = await page.locator("#swatches .sw:not(.add)").count();
  t("刷新页面后衣橱数据持久保留", persisted >= 2, "保留" + persisted + "支");

  /* ========== 品牌色号与照片取色 ========== */
  await page.click(".sw.add");
  await page.selectOption("#wdBrandSel", "0,0");
  await page.waitForTimeout(200);
  const bName = await page.locator("#wdName").inputValue();
  const bColor = (await page.locator("#wdColor").inputValue()).toLowerCase();
  t("品牌色号选择后自动填入名称与颜色", bName.includes("MAC") && bColor === "#b7202e",
    bName + " / " + bColor);

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

  /* ========== 收尾 ========== */
  await page.waitForTimeout(400);
  const shotPath = path.join(__dirname, "e2e-screenshot.png");
  await page.screenshot({ path: shotPath });
  t("测试截图已保存", fs.existsSync(shotPath));
  t("全程无JavaScript错误", errors.length === 0, errors.length ? errors.slice(0, 2).join(" | ") : "0个错误");

  await browser.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试框架异常:", e); process.exit(2); });
