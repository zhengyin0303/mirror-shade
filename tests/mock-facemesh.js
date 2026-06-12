// Mock MediaPipe FaceMesh —— 输出合成人脸关键点用于自动化测试
// 通过 window.__face = {dx, dy} 可模拟头部移动
// 覆盖锚点:唇环/眉弓/上睑/颧点/鬓侧/鼻梁,与 index.html 渲染索引一一对应
(function () {
  window.__face = { dx: 0, dy: 0, jitter: 0 };   // jitter: 每帧随机噪声幅度(归一化坐标),模拟识别抖动

  function genLandmarks() {
    const { dx, dy, jitter } = window.__face;
    const j = jitter || 0;
    const pts = [];
    for (let i = 0; i < 478; i++) pts.push({ x: 0.5 + dx, y: 0.45 + dy, z: 0 });
    const set = (i, x, y) => { pts[i] = { x: x + dx + (Math.random() - 0.5) * j,
                                          y: y + dy + (Math.random() - 0.5) * j, z: 0 }; };
    // 鼻尖(变焦中心)与肤色采样点(脸颊/额头)
    set(1, 0.5, 0.45);
    set(101, 0.42, 0.42); set(330, 0.58, 0.42);
    set(108, 0.45, 0.32); set(337, 0.55, 0.32);
    // 腮红锚点:颧点(205/425,渲染与手涂基轴)/ 鬓侧(234/454,斜扫)/ 鼻梁(195,晒伤)
    set(205, 0.40, 0.47); set(425, 0.60, 0.47);
    set(234, 0.33, 0.45); set(454, 0.67, 0.45);
    set(195, 0.50, 0.42);
    // 颊辅点(50/280,质心基轴)与鼻翼(129/358,腮红锁区内边界)
    set(50, 0.41, 0.44);  set(280, 0.59, 0.44);
    set(129, 0.46, 0.46); set(358, 0.54, 0.46);
    // 眉弓上下弧 + 上睑弧线(v2.2眉妆/v2.4眼影渲染与采样锚点,索引与正式版一致)
    // 左眉顶[70..107]外→内,底[55..46]内→外;右侧镜像。中点(105/334)为眉峰
    [[70,63,105,66,107,-1], [300,293,334,296,336,1]].forEach(a => { const s = a[5];
      a.slice(0,5).forEach((id, j) => set(id, 0.5 + s*(0.145 - j*0.0275), 0.328 + 0.004*Math.abs(j-2))); });
    [[55,65,52,53,46,-1], [285,295,282,283,276,1]].forEach(a => { const s = a[5];
      a.slice(0,5).forEach((id, j) => set(id, 0.5 + s*(0.035 + j*0.0275), 0.350)); });
    // 上睑弧线内→外(中点159/386最高),眼影沿此弧向上晕染
    [133,173,157,158,159,160,161,246,33].forEach((id, j) =>
      set(id, 0.465 - j*0.0125, 0.405 - 0.013*Math.sin(Math.PI*j/8)));
    [362,398,384,385,386,387,388,466,263].forEach((id, j) =>
      set(id, 0.535 + j*0.0125, 0.405 - 0.013*Math.sin(Math.PI*j/8)));
    // 唇部内外环(与正式版相同的索引与环序)
    const OUTER = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
    const INNER = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
    const cx = 0.5, cy = 0.62;
    OUTER.forEach((id, j) => { const a = Math.PI - j * Math.PI / 10;
      set(id, cx + 0.085 * Math.cos(a), cy + 0.040 * Math.sin(a)); });
    INNER.forEach((id, j) => { const a = Math.PI - j * Math.PI / 10;
      set(id, cx + 0.055 * Math.cos(a), cy + 0.018 * Math.sin(a)); });
    // 张嘴模拟:window.__face.mouthOpen = k(归一化)→ 下唇外环+下唇内环整体下移,
    // 上下内环之间形成口腔开口(用于唇手涂"张嘴不断裂"断言)
    const mo = window.__face.mouthOpen || 0;
    if (mo) {
      for (const id of [146,91,181,84,17,314,405,321,375]) pts[id].y += mo;
      for (const id of [95,88,178,87,14,317,402,318,324]) pts[id].y += mo;
    }
    return pts;
  }

  window.FaceMesh = class {
    constructor(opts) {}
    setOptions(o) {}
    onResults(cb) { this.cb = cb; }
    initialize() { return Promise.resolve(); }
    async send(_) {
      if (this.cb) this.cb({ multiFaceLandmarks: [genLandmarks()] });
    }
  };
})();
