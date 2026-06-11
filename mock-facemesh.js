// Mock MediaPipe FaceMesh —— 输出合成人脸关键点用于自动化测试
// 通过 window.__face = {dx, dy} 可模拟头部移动
(function () {
  window.__face = { dx: 0, dy: 0 };

  function genLandmarks() {
    const { dx, dy } = window.__face;
    const pts = [];
    for (let i = 0; i < 478; i++) pts.push({ x: 0.5 + dx, y: 0.45 + dy, z: 0 });
    const set = (i, x, y) => { pts[i] = { x: x + dx, y: y + dy, z: 0 }; };
    // 鼻尖(变焦中心)与肤色采样点(脸颊/额头)
    set(1, 0.5, 0.45);
    set(101, 0.42, 0.42); set(330, 0.58, 0.42);
    set(108, 0.45, 0.32); set(337, 0.55, 0.32);
    // 唇部内外环(与正式版相同的索引与环序)
    const OUTER = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
    const INNER = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
    const cx = 0.5, cy = 0.62;
    OUTER.forEach((id, j) => { const a = Math.PI - j * Math.PI / 10;
      set(id, cx + 0.085 * Math.cos(a), cy + 0.040 * Math.sin(a)); });
    INNER.forEach((id, j) => { const a = Math.PI - j * Math.PI / 10;
      set(id, cx + 0.055 * Math.cos(a), cy + 0.018 * Math.sin(a)); });
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
