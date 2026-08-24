/* 指板全屏放大 + 自由标注
 * 用法：FretboardAnnotate.open(sourceSvgEl, titleText)
 * - 克隆 sourceSvgEl 到全屏舞台，叠加 canvas 标注层
 * - 标注类型：自由笔迹(free) / 圈选(circle) / 箭头(arrow) / 文字(text) / 高亮(highlight)
 * - 支持颜色、笔触大小、撤销、一键清除、退出全屏
 * - 移动端：单指绘制，双指捏合缩放/拖动平移舞台
 * - 标注仅存于 overlay，完全不影响底层指板数据
 */
(function () {
  "use strict";

  const COLORS = ["#ff5a5a", "#ffd23f", "#4ade80", "#38bdf8", "#a78bfa", "#ffffff"];
  const TOOLS = {
    select: { icon: "⌖", label: "选择" },
    free: { icon: "✎", label: "笔迹" },
    circle: { icon: "◯", label: "圈选" },
    arrow: { icon: "↗", label: "箭头" },
    text: { icon: "T", label: "文字" },
    highlight: { icon: "⦿", label: "高亮" },
    eraser: { icon: "⌫", label: "橡皮擦" },
    shot: { icon: "▣", label: "截图" },
  };

  let overlay = null;
  let stage = null;
  let stageInner = null;
  let board = null;     // 可标注画板（大于指板克隆，覆盖舞台主要区域）
  let canvas = null;
  let ctx = null;
  let textInput = null;

  let sourceSvg = null;
  let dpr = 1;
  let baseScale = 1; // 适配视口的基础缩放
  let userScale = 1; // 用户捏合缩放
  let panX = 0;
  let panY = 0;
  let boardW = 1000; // 可标注画板宽度
  let boardH = 600;  // 可标注画板高度

  const state = {
    tool: "free",
    color: COLORS[0],
    size: 4,
    strokes: [], // 已完成标注 {type,color,size,points?|text?|x,y?|...}
    eraseWidth: 12, // 橡皮擦范围
  };

  let drawing = null; // 当前正在绘制的标注
  let pointers = new Map(); // pointerId -> {x,y}
  let lastPinchDist = 0;
  let pinchCenter = { x: 0, y: 0 }; // 双指（或滚轮）缩放焦点，屏幕坐标
  let shotSel = null; // 截图框选 {x0,y0,x1,y1}（canvas 本地坐标）
  let eraserPreview = null; // 橡皮擦预览圆心（canvas 本地坐标）

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "fb-fullscreen-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "指板全屏标注");
    overlay.innerHTML = `
      <div class="fb-fs-toolbar">
        <div class="fb-fs-title"><span class="dot"></span><span class="fb-fs-title-text">指板全屏</span></div>
        <div class="fb-fs-group" id="fbFsTools" aria-label="标注工具">
          ${Object.entries(TOOLS)
            .map(
              ([k, v]) =>
                `<button type="button" class="fb-fs-tool${k === "free" ? " active" : ""}" data-tool="${k}" title="${v.label}">${v.icon}</button>`
            )
            .join("")}
        </div>
        <div class="fb-fs-group" id="fbFsColors" aria-label="标记颜色">
          <span class="fb-fs-label">颜色</span>
          ${COLORS.map(
            (c, i) =>
              `<button type="button" class="fb-fs-swatch${i === 0 ? " active" : ""}" data-color="${c}" style="background:${c}" aria-label="颜色 ${c}"></button>`
          ).join("")}
        </div>
        <div class="fb-fs-group" aria-label="笔触大小">
          <span class="fb-fs-label">粗细</span>
          <input type="range" class="fb-fs-size" id="fbFsSize" min="2" max="20" value="4" aria-label="笔触大小" />
        </div>
        <div class="fb-fs-group fb-fs-eraser-size" id="fbFsEraserSizeGroup" aria-label="擦除范围">
          <span class="fb-fs-label">擦除</span>
          <input type="range" class="fb-fs-size" id="fbFsEraseSize" min="4" max="60" value="12" aria-label="擦除范围" />
        </div>
        <div class="fb-fs-group" aria-label="操作">
          <button type="button" class="fb-fs-tool" id="fbFsUndo" title="撤销">↺</button>
          <button type="button" class="fb-fs-tool" id="fbFsClear" title="清除全部">🗑</button>
        </div>
        <button type="button" class="fb-fs-exit" id="fbFsExit">退出全屏 ✕</button>
      </div>
      <div class="fb-fs-stage" id="fbFsStage">
        <div class="fb-fs-stage-inner" id="fbFsStageInner"></div>
      </div>
      <p class="fb-fs-hint">滚轮 / 双指捏合缩放，拖拽空白区平移；标注仅显示于本视图，不影响底层指板。</p>
    `;
    document.body.appendChild(overlay);

    stage = overlay.querySelector("#fbFsStage");
    stageInner = overlay.querySelector("#fbFsStageInner");
    board = document.createElement("div");
    board.className = "fb-fs-board";
    stageInner.appendChild(board);
    canvas = document.createElement("canvas");
    canvas.className = "fb-fs-canvas";
    board.appendChild(canvas);
    ctx = canvas.getContext("2d");

    // 工具
    overlay.querySelector("#fbFsTools").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tool]");
      if (!btn) return;
      setTool(btn.dataset.tool);
    });
    // 颜色
    overlay.querySelector("#fbFsColors").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-color]");
      if (!btn) return;
      state.color = btn.dataset.color;
      overlay.querySelectorAll(".fb-fs-swatch").forEach((s) => s.classList.toggle("active", s === btn));
    });
    // 粗细
    overlay.querySelector("#fbFsSize").addEventListener("input", (e) => {
      state.size = Number(e.target.value);
      redraw();
    });
    // 擦除范围
    overlay.querySelector("#fbFsEraseSize").addEventListener("input", (e) => {
      state.eraseWidth = Number(e.target.value);
      redraw();
    });
    // 撤销 / 清除 / 退出
    overlay.querySelector("#fbFsUndo").addEventListener("click", undo);
    overlay.querySelector("#fbFsClear").addEventListener("click", clearAll);
    overlay.querySelector("#fbFsExit").addEventListener("click", close);

    // 指针事件（统一鼠标/触控/笔）
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

    // 滚轮缩放
    stage.addEventListener("wheel", onWheel, { passive: false });
  }

  function setTool(tool) {
    state.tool = tool;
    overlay.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    stageInner.classList.toggle("text-mode", tool === "text");
    // 橡皮擦：显示擦除范围控制并隐藏笔触粗细；其余工具反之
    const eraseGroup = overlay.querySelector("#fbFsEraserSizeGroup");
    const sizeGroup = overlay.querySelector("#fbFsSize").closest(".fb-fs-group");
    if (eraseGroup) eraseGroup.style.display = tool === "eraser" ? "flex" : "none";
    if (sizeGroup) sizeGroup.style.display = tool === "eraser" ? "none" : "flex";
    shotSel = null;
    eraserPreview = null;
    redraw();
  }

  function open(sourceSvgEl, title) {
    if (!sourceSvgEl) return;
    sourceSvg = sourceSvgEl;
    if (!overlay) buildOverlay();
    if (title) overlay.querySelector(".fb-fs-title-text").textContent = title;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";

    // 克隆指板 SVG 到可标注画板中
    board.querySelectorAll("svg, .fretboard, .fretboard-grid").forEach((n) => n.remove());
    const clone = sourceSvg.cloneNode(true);
    clone.removeAttribute("id");
    board.insertBefore(clone, canvas);

    // 重置状态
    state.strokes = [];
    state.tool = "free";
    state.color = COLORS[0];
    state.size = 4;
    setTool("free");
    overlay.querySelectorAll(".fb-fs-swatch").forEach((s, i) => s.classList.toggle("active", i === 0));
    overlay.querySelector("#fbFsSize").value = "4";
    userScale = 1;
    panX = 0;
    panY = 0;

    // 等待布局稳定后适配尺寸（fitToStage 内部会先测量克隆尺寸再重建画布）
    requestAnimationFrame(() => {
      fitToStage();
      redraw();
    });

    document.addEventListener("keydown", onKey);
  }

  function close() {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    drawing = null;
    pointers.clear();
    shotSel = null;
    eraserPreview = null;
    if (textInput) { textInput.remove(); textInput = null; }
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  }

  /* ---------- 尺寸与适配 ---------- */
  let cloneW = 1000;
  let cloneH = 300;

  function clampScale(s) {
    return Math.max(0.4, Math.min(6, s));
  }

  // 以屏幕坐标 (sx, sy) 为焦点缩放：保持该点在缩放前后屏幕位置不变
  function zoomAround(sx, sy, ratio) {
    const sRect = stage.getBoundingClientRect();
    const stageCx = sRect.left + sRect.width / 2;
    const stageCy = sRect.top + sRect.height / 2;
    const newScale = baseScale * userScale * ratio;
    // 当前 stageInner 变换：screen = stageC + (local + pan) * scale
    // 令焦点本地点不变，缩放后其屏幕位置仍为 (sx, sy)：
    //   sx = stageCx + (lx + panX_new) * newScale  =>  panX_new = (sx - stageCx)/newScale - lx
    //   其中 lx = (sx - stageCx)/(oldScale) - panX
    const oldScale = baseScale * userScale;
    const lx = (sx - stageCx) / oldScale - panX;
    const ly = (sy - stageCy) / oldScale - panY;
    panX = (sx - stageCx) / newScale - lx;
    panY = (sy - stageCy) / newScale - ly;
  }

  // 工具：将屏幕坐标转为 stageInner 本地坐标（基于当前变换）
  function screenToLocal(sx, sy) {
    const sRect = stage.getBoundingClientRect();
    const stageCx = sRect.left + sRect.width / 2;
    const stageCy = sRect.top + sRect.height / 2;
    const ox = sx - stageCx;
    const oy = sy - stageCy;
    return {
      x: ox / (baseScale * userScale) - panX,
      y: oy / (baseScale * userScale) - panY,
    };
  }
  // 工具：将 stageInner 本地坐标转为屏幕坐标
  function localToScreen(lx, ly) {
    const sRect = stage.getBoundingClientRect();
    const stageCx = sRect.left + sRect.width / 2;
    const stageCy = sRect.top + sRect.height / 2;
    const ox = (lx + panX) * (baseScale * userScale);
    const oy = (ly + panY) * (baseScale * userScale);
    return { x: stageCx + ox, y: stageCy + oy };
  }

  function getClone() {
    return board.querySelector("svg, .fretboard, .fretboard-grid") || board.firstElementChild;
  }

  function sizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    // 画布尺寸与可标注画板一致，覆盖舞台主要区域（含指板上下方空白）
    canvas.width = Math.max(1, Math.round(boardW * dpr));
    canvas.height = Math.max(1, Math.round(boardH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fitToStage() {
    const clone = getClone();
    if (!clone) return;
    // 重置变换以测量自然尺寸
    stageInner.style.transform = "none";
    stageInner.style.width = "auto";
    stageInner.style.height = "auto";
    const rect = clone.getBoundingClientRect();
    cloneW = rect.width || cloneW;
    cloneH = rect.height || cloneH;
    const sRect = stage.getBoundingClientRect();
    const pad = 0.96;
    // 可标注画板铺满舞台，使用户能在指板上下方空白区也进行标注
    boardW = Math.round(sRect.width * pad);
    boardH = Math.round(sRect.height * pad);
    board.style.width = boardW + "px";
    board.style.height = boardH + "px";
    // 画板已按舞台尺寸设置，基础缩放为 1；用户双指/滚轮在 1 的基础上缩放
    baseScale = 1;
    sizeCanvas();
    applyTransform();
  }

  function applyTransform() {
    const scale = baseScale * userScale;
    stageInner.style.width = boardW + "px";
    stageInner.style.height = boardH + "px";
    stageInner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    redraw();
  }

  /* ---------- 绘制 ---------- */
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of state.strokes) drawStroke(s);
    if (drawing) drawStroke(drawing);
    // 橡皮擦范围预览
    if (state.tool === "eraser" && eraserPreview) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(eraserPreview.x, eraserPreview.y, state.eraseWidth / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 截图框选
    if (state.tool === "shot" && shotSel) {
      const x = Math.min(shotSel.x0, shotSel.x1);
      const y = Math.min(shotSel.y0, shotSel.y1);
      const w = Math.abs(shotSel.x1 - shotSel.x0);
      const h = Math.abs(shotSel.y1 - shotSel.y0);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(155,197,217,0.15)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#9bc5d9";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      // 显示尺寸
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 6, y + 6);
      ctx.restore();
    }
  }

  function drawStroke(s, target) {
    const c = target || ctx;
    c.save();
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineWidth = s.size;
    c.lineCap = "round";
    c.lineJoin = "round";

    if (s.type === "eraser") {
      // 擦除：destination-out 只影响画布上的标注，不影响指板克隆
      c.globalCompositeOperation = "destination-out";
      c.lineWidth = s.size;
      const pts = s.points;
      if (!pts || pts.length === 0) { c.restore(); return; }
      if (pts.length === 1) {
        c.beginPath();
        c.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
        c.fill();
      } else {
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) c.lineTo(pts[i].x, pts[i].y);
        c.stroke();
      }
    } else if (s.type === "free" || s.type === "highlight") {
      const pts = s.points;
      if (!pts || pts.length === 0) { c.restore(); return; }
      if (s.type === "highlight") c.globalAlpha = 0.35;
      if (pts.length === 1) {
        c.beginPath();
        c.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
        c.fill();
      } else {
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) c.lineTo(pts[i].x, pts[i].y);
        c.stroke();
      }
    } else if (s.type === "circle") {
      const { x0, y0, x1, y1 } = s;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      c.beginPath();
      c.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
      c.stroke();
    } else if (s.type === "arrow") {
      const { x0, y0, x1, y1 } = s;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(10, s.size * 3);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x1 - head * Math.cos(ang - Math.PI / 6), y1 - head * Math.sin(ang - Math.PI / 6));
      c.lineTo(x1 - head * Math.cos(ang + Math.PI / 6), y1 - head * Math.sin(ang + Math.PI / 6));
      c.closePath();
      c.fill();
    } else if (s.type === "text") {
      c.globalAlpha = 1;
      c.font = `700 ${Math.max(14, s.size * 4)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      c.textBaseline = "middle";
      c.fillText(s.text, s.x, s.y);
    }
    c.restore();
  }

  /* ---------- 坐标换算（canvas 内部坐标 = SVG 用户坐标，因为画布与 SVG 同尺寸并通过外层 transform 缩放）---------- */
  function toCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / (rect.width / canvas.offsetWidth || 1),
      y: (e.clientY - rect.top) / (rect.height / canvas.offsetHeight || 1),
    };
  }

  /* ---------- 指针交互 ---------- */
  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      lastPinchDist = pinchDistance();
      // 记录双指中心（屏幕坐标），作为缩放焦点，确保缩放前后该点屏幕位置不变
      pinchCenter = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      drawing = null; // 多指时取消当前绘制，进入平移/缩放
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvasCoords(e);

    if (state.tool === "text") {
      placeText(p);
      return;
    }
    if (state.tool === "eraser") {
      drawing = { type: "eraser", size: state.eraseWidth, points: [p] };
    } else if (state.tool === "shot") {
      shotSel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      drawing = { type: "_shot" };
    } else if (state.tool === "highlight") {
      drawing = { type: "highlight", color: state.color, size: state.size * 3, points: [p] };
    } else if (state.tool === "free") {
      drawing = { type: "free", color: state.color, size: state.size, points: [p] };
    } else if (state.tool === "circle" || state.tool === "arrow") {
      drawing = { type: state.tool, color: state.color, size: state.size, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    } else {
      // select：作为平移起点
      drawing = { type: "_pan", x0: e.clientX, y0: e.clientY, panX0: panX, panY0: panY };
    }
    redraw();
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const d = pinchDistance();
      const pts = Array.from(pointers.values());
      const curCenter = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      if (lastPinchDist > 0) {
        const newScale = clampScale(userScale * (d / lastPinchDist));
        zoomAround(pinchCenter.x, pinchCenter.y, newScale / userScale);
        userScale = newScale;
      }
      // 双指整体平移：以两指中心移动量更新平移（屏幕坐标差 → 本地坐标差），使焦点跟随手指移动
      const scale = baseScale * userScale;
      panX += (curCenter.x - pinchCenter.x) / scale;
      panY += (curCenter.y - pinchCenter.y) / scale;
      pinchCenter = curCenter;
      applyTransform();
      lastPinchDist = d;
      return;
    }

    const p = toCanvasCoords(e);

    // 橡皮擦悬停预览（未绘制时也显示擦除范围圆）
    if (state.tool === "eraser" && !drawing) {
      eraserPreview = p;
      redraw();
    }

    if (!drawing) return;
    if (drawing.type === "_pan") {
      panX = drawing.panX0 + (e.clientX - drawing.x0);
      panY = drawing.panY0 + (e.clientY - drawing.y0);
      applyTransform();
      return;
    }
    if (drawing.type === "_shot") {
      shotSel.x1 = p.x;
      shotSel.y1 = p.y;
      redraw();
      return;
    }
    if (drawing.type === "free" || drawing.type === "highlight" || drawing.type === "eraser") {
      drawing.points.push(p);
    } else if (drawing.type === "circle" || drawing.type === "arrow") {
      drawing.x1 = p.x;
      drawing.y1 = p.y;
    }
    redraw();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    eraserPreview = null;
    if (!drawing) return;
    const d = drawing;
    drawing = null;

    // 截图框选完成：触发导出
    if (d.type === "_shot") {
      const w = Math.abs(shotSel.x1 - shotSel.x0);
      const h = Math.abs(shotSel.y1 - shotSel.y0);
      if (w >= 6 && h >= 6) {
        captureRegion(shotSel);
      }
      shotSel = null;
      redraw();
      return;
    }

    // 过滤无效标注
    let valid = true;
    if ((d.type === "free" || d.type === "highlight" || d.type === "eraser") && (!d.points || d.points.length === 0)) valid = false;
    if ((d.type === "circle" || d.type === "arrow") && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) valid = false;
    if (d.type === "_pan") return; // 平移不入库
    if (valid) state.strokes.push(d);
    redraw();
  }

  function pinchDistance() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function placeText(p) {
    if (textInput) textInput.remove();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "fb-fs-text-input fb-fs-text-input-fixed";
    input.placeholder = "输入批注";
    // 将 clone 本地坐标映射到屏幕坐标，输入框固定于 overlay 层，避免受舞台 transform 影响
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + p.x * (rect.width / canvas.offsetWidth);
    const sy = rect.top + p.y * (rect.height / canvas.offsetHeight);
    input.style.left = sx + "px";
    input.style.top = sy + "px";
    input.style.color = state.color;
    input.style.fontSize = Math.max(14, state.size * 4) + "px";
    overlay.appendChild(input);
    textInput = input;
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
    const commit = () => {
      const txt = input.value.trim();
      if (txt) {
        state.strokes.push({ type: "text", color: state.color, size: state.size, x: p.x, y: p.y, text: txt });
      }
      input.remove();
      if (textInput === input) textInput = null;
      redraw();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
      else if (ev.key === "Escape") { input.value = ""; input.blur(); }
    });
  }

  /* ---------- 截图导出 ---------- */
  const SVG_STYLE_PROPS = [
    "fill", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
    "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size",
    "font-weight", "font-style", "text-anchor", "letter-spacing",
    "dominant-baseline", "color", "paint-order", "display", "visibility",
  ];
  const HTML_STYLE_PROPS = [
    "display", "position", "grid-template-columns", "grid-template-rows",
    "gap", "padding", "margin", "border", "border-radius", "background",
    "background-color", "color", "font-family", "font-size", "font-weight",
    "text-align", "line-height", "min-width", "min-height", "width", "height",
    "box-sizing", "align-items", "justify-items", "place-items",
    "flex", "flex-direction", "flex-wrap", "overflow", "transform", "letter-spacing",
  ];

  // 并行遍历源节点与克隆节点，将计算样式内联到 style 属性（SVG/HTML 通用）
  function inlineComputedStyles(srcRoot, dstRoot, props) {
    const stack = [[srcRoot, dstRoot]];
    while (stack.length) {
      const [s, d] = stack.pop();
      if (!d || d.nodeType !== 1) continue;
      const cs = window.getComputedStyle(s);
      const parts = [];
      for (const p of props) {
        const v = cs.getPropertyValue(p);
        if (v && v !== "none") parts.push(`${p}: ${v}`);
      }
      if (parts.length) d.setAttribute("style", parts.join("; "));
      for (let i = 0; i < s.children.length; i += 1) stack.push([s.children[i], d.children[i]]);
    }
  }

  function svgToDataUrl(svgNode) {
    const clone = svgNode.cloneNode(true);
    inlineComputedStyles(svgNode, clone, SVG_STYLE_PROPS);
    const xml = new XMLSerializer().serializeToString(clone);
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  }

  function htmlToDataUrl(htmlNode, w, h) {
    const clone = htmlNode.cloneNode(true);
    inlineComputedStyles(htmlNode, clone, HTML_STYLE_PROPS);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<foreignObject width="100%" height="100%">${clone.outerHTML}</foreignObject></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function rasterizeFretboard() {
    return new Promise((resolve) => {
      const clone = getClone();
      if (!clone) { resolve(null); return; }
      let dataUrl;
      try {
        dataUrl = clone.tagName.toLowerCase() === "svg"
          ? svgToDataUrl(clone)
          : htmlToDataUrl(clone, cloneW, cloneH);
      } catch (e) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function showToast(msg) {
    let toast = overlay.querySelector(".fb-fs-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "fb-fs-toast";
      overlay.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  // 框选区域导出 PNG：指板克隆光栅化 + 标注叠加 + 裁剪下载
  function captureRegion(sel) {
    const x = Math.min(sel.x0, sel.x1);
    const y = Math.min(sel.y0, sel.y1);
    const w = Math.abs(sel.x1 - sel.x0);
    const h = Math.abs(sel.y1 - sel.y0);
    if (w < 4 || h < 4) return;

    const scale = Math.max(2, window.devicePixelRatio || 1); // 高分辨率导出
    const off = document.createElement("canvas");
    // 导出画布使用可标注画板尺寸，指板克隆居中绘制
    off.width = Math.max(1, Math.round(boardW * scale));
    off.height = Math.max(1, Math.round(boardH * scale));
    const octx = off.getContext("2d");
    octx.setTransform(scale, 0, 0, scale, 0, 0);

    rasterizeFretboard().then((img) => {
      if (img) {
        const dx = (boardW - cloneW) / 2;
        const dy = (boardH - cloneH) / 2;
        octx.drawImage(img, dx, dy, cloneW, cloneH);
      }

      // 标注单独一层绘制（橡皮擦 destination-out 只擦标注），再与指板合成
      const anno = document.createElement("canvas");
      anno.width = off.width;
      anno.height = off.height;
      const actx = anno.getContext("2d");
      actx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const s of state.strokes) drawStroke(s, actx);
      octx.drawImage(anno, 0, 0);

      // 裁剪选中区域
      const crop = document.createElement("canvas");
      crop.width = Math.max(1, Math.round(w * scale));
      crop.height = Math.max(1, Math.round(h * scale));
      const cctx = crop.getContext("2d");
      cctx.drawImage(off, x * scale, y * scale, w * scale, h * scale, 0, 0, crop.width, crop.height);

      const a = document.createElement("a");
      a.href = crop.toDataURL("image/png");
      a.download = `fretboard-annotate-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("截图已导出");
    });
  }

  /* ---------- 操作 ---------- */
  function undo() {
    state.strokes.pop();
    shotSel = null;
    redraw();
  }
  function clearAll() {
    state.strokes = [];
    shotSel = null;
    redraw();
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAround(e.clientX, e.clientY, factor);
    userScale = clampScale(userScale * factor);
    applyTransform();
  }

  // 将内部坐标变换/测试工具暴露（仅测试用）
  window.FretboardAnnotate = window.FretboardAnnotate || {};
  window.FretboardAnnotate._screenToLocal = screenToLocal;
  window.FretboardAnnotate._localToScreen = localToScreen;

  // 窗口尺寸变化时重新适配
  function onResize() {
    if (!overlay || !overlay.classList.contains("open")) return;
    fitToStage();
  }
  window.addEventListener("resize", onResize);

  window.FretboardAnnotate = Object.assign(window.FretboardAnnotate || {}, {
    open,
    close,
    // 仅供测试：返回当前标注数量
    _strokeCount: () => state.strokes.length,
  });
})();
