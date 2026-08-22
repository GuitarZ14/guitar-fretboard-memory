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
  };

  let overlay = null;
  let stage = null;
  let stageInner = null;
  let canvas = null;
  let ctx = null;
  let textInput = null;

  let sourceSvg = null;
  let dpr = 1;
  let baseScale = 1; // 适配视口的基础缩放
  let userScale = 1; // 用户捏合缩放
  let panX = 0;
  let panY = 0;

  const state = {
    tool: "free",
    color: COLORS[0],
    size: 4,
    strokes: [], // 已完成标注 {type,color,size,points?|text?|x,y?|...}
  };

  let drawing = null; // 当前正在绘制的标注
  let pointers = new Map(); // pointerId -> {x,y}
  let lastPinchDist = 0;

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
    canvas = document.createElement("canvas");
    canvas.className = "fb-fs-canvas";
    stageInner.appendChild(canvas);
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
  }

  function open(sourceSvgEl, title) {
    if (!sourceSvgEl) return;
    sourceSvg = sourceSvgEl;
    if (!overlay) buildOverlay();
    if (title) overlay.querySelector(".fb-fs-title-text").textContent = title;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";

    // 克隆指板 SVG
    stageInner.querySelectorAll("svg, .fb-fs-canvas").forEach((n) => { if (n !== canvas) n.remove(); });
    const clone = sourceSvg.cloneNode(true);
    clone.removeAttribute("id");
    stageInner.insertBefore(clone, canvas);

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

    // 等待布局稳定后设置画布尺寸
    requestAnimationFrame(() => {
      sizeCanvas();
      fitToStage();
      redraw();
    });

    document.addEventListener("keydown", onKey);
  }

  function close() {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  }

  /* ---------- 尺寸与适配 ---------- */
  let cloneW = 1000;
  let cloneH = 300;

  function getClone() {
    return stageInner.querySelector("svg, .fretboard, .fretboard-grid") || stageInner.firstElementChild;
  }

  function sizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    // 画布在 stageInner 本地坐标系内尺寸 = clone 自然尺寸；外层 CSS transform 负责缩放
    canvas.width = Math.max(1, Math.round(cloneW * dpr));
    canvas.height = Math.max(1, Math.round(cloneH * dpr));
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
    baseScale = Math.min((sRect.width * pad) / cloneW, (sRect.height * pad) / cloneH);
    applyTransform();
  }

  function applyTransform() {
    const scale = baseScale * userScale;
    stageInner.style.width = cloneW + "px";
    stageInner.style.height = cloneH + "px";
    stageInner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    // 画布覆盖在 clone 上（同坐标系）
    canvas.style.width = cloneW + "px";
    canvas.style.height = cloneH + "px";
    redraw();
  }

  /* ---------- 绘制 ---------- */
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of state.strokes) drawStroke(s);
    if (drawing) drawStroke(drawing);
  }

  function drawStroke(s) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (s.type === "free" || s.type === "highlight") {
      const pts = s.points;
      if (!pts || pts.length === 0) { ctx.restore(); return; }
      if (s.type === "highlight") ctx.globalAlpha = 0.35;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (s.type === "circle") {
      const { x0, y0, x1, y1 } = s;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === "arrow") {
      const { x0, y0, x1, y1 } = s;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(10, s.size * 3);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 6), y1 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 6), y1 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (s.type === "text") {
      ctx.globalAlpha = 1;
      ctx.font = `700 ${Math.max(14, s.size * 4)}px var(--font, sans-serif)`;
      ctx.textBaseline = "middle";
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.restore();
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
      lastPinchDist = pinchDistance();
      drawing = null; // 多指时取消当前绘制，进入平移/缩放
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvasCoords(e);

    if (state.tool === "text") {
      placeText(p);
      return;
    }
    if (state.tool === "highlight") {
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
      if (lastPinchDist > 0) {
        const cx = (stage.getBoundingClientRect().width - canvas.getBoundingClientRect().width) / 2;
        userScale = Math.max(0.4, Math.min(6, userScale * (d / lastPinchDist)));
        applyTransform();
      }
      lastPinchDist = d;
      return;
    }

    const p = toCanvasCoords(e);
    if (!drawing) return;
    if (drawing.type === "_pan") {
      panX = drawing.panX0 + (e.clientX - drawing.x0);
      panY = drawing.panY0 + (e.clientY - drawing.y0);
      applyTransform();
      return;
    }
    if (drawing.type === "free" || drawing.type === "highlight") {
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
    if (!drawing) return;
    const d = drawing;
    drawing = null;

    // 过滤无效标注
    let valid = true;
    if ((d.type === "free" || d.type === "highlight") && (!d.points || d.points.length === 0)) valid = false;
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
    input.className = "fb-fs-text-input";
    input.placeholder = "输入批注";
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.offsetWidth || 1;
    input.style.left = (p.x * scale) + "px";
    input.style.top = (p.y * scale) + "px";
    input.style.color = state.color;
    input.style.fontSize = Math.max(14, state.size * 4) + "px";
    stageInner.appendChild(input);
    textInput = input;
    input.focus();
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

  /* ---------- 操作 ---------- */
  function undo() {
    state.strokes.pop();
    redraw();
  }
  function clearAll() {
    state.strokes = [];
    redraw();
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    userScale = Math.max(0.4, Math.min(6, userScale * factor));
    applyTransform();
  }

  // 窗口尺寸变化时重新适配
  function onResize() {
    if (!overlay || !overlay.classList.contains("open")) return;
    sizeCanvas();
    fitToStage();
  }
  window.addEventListener("resize", onResize);

  window.FretboardAnnotate = {
    open,
    close,
    // 仅供测试：返回当前标注数量
    _strokeCount: () => state.strokes.length,
  };
})();
