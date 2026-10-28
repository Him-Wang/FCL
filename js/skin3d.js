/* FCL · 3D 皮肤预览（CSS 3D 实现，不引入 three.js）
 *
 * 思路与 KCL / skinview3d 一致，只是把 WebGL 换成 CSS 3D：
 *   1. 按 Minecraft 官方 UV 把 64×64 皮肤切成 6 个面 × 6 个部件
 *   2. 每个部件是一个盒子（宽 w、高 h、深 d），6 个面用 background-position 取样
 *   3. 面尺寸按「1 皮肤像素 = S 屏幕像素」换算，S 根据预览区大小自适应
 *   4. 每个面加一点明暗（模拟光照），立体感更强、细节更清楚
 *   5. 鼠标拖拽旋转、滚轮缩放、空闲时缓慢自转
 */
(function () {
  'use strict';

  /* ---------------- 皮肤 UV 表（64×64） ---------------- */
  const UV = {
    head: {
      top: [8, 0, 8, 8], bottom: [16, 0, 8, 8], right: [0, 8, 8, 8],
      front: [8, 8, 8, 8], left: [16, 8, 8, 8], back: [24, 8, 8, 8],
    },
    body: {
      top: [20, 16, 8, 4], bottom: [28, 16, 8, 4], right: [16, 20, 4, 12],
      front: [20, 20, 8, 12], left: [28, 20, 4, 12], back: [32, 20, 8, 12],
    },
    armR: {
      top: [44, 16, 4, 4], bottom: [48, 16, 4, 4], right: [40, 20, 4, 12],
      front: [44, 20, 4, 12], left: [48, 20, 4, 12], back: [52, 20, 4, 12],
    },
    armL: {
      top: [36, 48, 4, 4], bottom: [40, 48, 4, 4], right: [32, 52, 4, 12],
      front: [36, 52, 4, 12], left: [40, 52, 4, 12], back: [44, 52, 4, 12],
    },
    legR: {
      top: [4, 16, 4, 4], bottom: [8, 16, 4, 4], right: [0, 20, 4, 12],
      front: [4, 20, 4, 12], left: [8, 20, 4, 12], back: [12, 20, 4, 12],
    },
    legL: {
      top: [20, 48, 4, 4], bottom: [24, 48, 4, 4], right: [16, 52, 4, 12],
      front: [20, 52, 4, 12], left: [24, 52, 4, 12], back: [28, 52, 4, 12],
    },
  };

  /* 第二层：帽子 / 外套 / 袖子 / 裤腿 */
  const UV2 = {
    head: {
      top: [40, 0, 8, 8], bottom: [48, 0, 8, 8], right: [32, 8, 8, 8],
      front: [40, 8, 8, 8], left: [48, 8, 8, 8], back: [56, 8, 8, 8],
    },
    body: {
      top: [20, 32, 8, 4], bottom: [28, 32, 8, 4], right: [16, 36, 4, 12],
      front: [20, 36, 8, 12], left: [28, 36, 4, 12], back: [32, 36, 8, 12],
    },
    armR: {
      top: [44, 32, 4, 4], bottom: [48, 32, 4, 4], right: [40, 36, 4, 12],
      front: [44, 36, 4, 12], left: [48, 36, 4, 12], back: [52, 36, 4, 12],
    },
    armL: {
      top: [52, 48, 4, 4], bottom: [56, 48, 4, 4], right: [48, 52, 4, 12],
      front: [52, 52, 4, 12], left: [56, 52, 4, 12], back: [60, 52, 4, 12],
    },
    legR: {
      top: [4, 32, 4, 4], bottom: [8, 32, 4, 4], right: [0, 36, 4, 12],
      front: [4, 36, 4, 12], left: [8, 36, 4, 12], back: [12, 36, 4, 12],
    },
    legL: {
      top: [4, 48, 4, 4], bottom: [8, 48, 4, 4], right: [0, 52, 4, 12],
      front: [4, 52, 4, 12], left: [8, 52, 4, 12], back: [12, 52, 4, 12],
    },
  };

  /* 纤细手臂（3 像素宽）的 UV 与经典模型不同 */
  const SLIM_UV = {
    armR: {
      top: [44, 16, 3, 4], bottom: [47, 16, 3, 4], right: [40, 20, 4, 12],
      front: [44, 20, 3, 12], left: [47, 20, 4, 12], back: [50, 20, 3, 12],
    },
    armL: {
      top: [36, 48, 3, 4], bottom: [39, 48, 3, 4], right: [32, 52, 4, 12],
      front: [36, 52, 3, 12], left: [39, 52, 4, 12], back: [42, 52, 3, 12],
    },
  };
  const SLIM_UV2 = {
    armR: {
      top: [44, 32, 3, 4], bottom: [47, 32, 3, 4], right: [40, 36, 4, 12],
      front: [44, 36, 3, 12], left: [47, 36, 4, 12], back: [50, 36, 3, 12],
    },
    armL: {
      top: [52, 48, 3, 4], bottom: [55, 48, 3, 4], right: [48, 52, 4, 12],
      front: [52, 52, 3, 12], left: [55, 52, 4, 12], back: [58, 52, 3, 12],
    },
  };

  /* 身体各部件：尺寸 + 中心（单位 = 皮肤像素，原点 = 身体几何中心） */
  const PARTS = [
    { id: 'head', size: [8, 8, 8], center: [0, -10, 0] },
    { id: 'body', size: [8, 12, 4], center: [0, 0, 0] },
    { id: 'armR', size: [4, 12, 4], center: [-6, 0, 0] },
    { id: 'armL', size: [4, 12, 4], center: [6, 0, 0] },
    { id: 'legR', size: [4, 12, 4], center: [-2, 12, 0] },
    { id: 'legL', size: [4, 12, 4], center: [2, 12, 0] },
  ];

  /* 每个面的明暗，模拟一个左上方的光源 */
  const LIGHT = { front: 1.0, back: 0.88, right: 0.84, left: 0.76, top: 1.14, bottom: 0.6 };

  let scene = null;

  function faceEl(url, rect, w, h, transform, light, overlay, px) {
    const [sx, sy, sw, sh] = rect;
    const el = document.createElement('div');
    el.className = 'sk3-face' + (overlay ? ' sk3-over' : '');
    el.style.width = sw * px + 'px';
    el.style.height = sh * px + 'px';
    el.style.left = (-(sw * px) / 2) + 'px';
    el.style.top = (-(sh * px) / 2) + 'px';
    el.style.backgroundImage = 'url("' + url + '")';
    el.style.backgroundSize = 64 * px + 'px ' + 64 * px + 'px';
    el.style.backgroundPosition = -sx * px + 'px ' + -sy * px + 'px';
    el.style.filter = 'brightness(' + light + ')';
    el.style.transform = transform;
    return el;
  }

  function buildBox(part, url, slim, overlay, px) {
    const [w, h, d] = part.size;
    const arm = slim && (part.id === 'armR' || part.id === 'armL');
    const aw = arm ? 3 : w;
    const slimTable = overlay ? SLIM_UV2 : SLIM_UV;
    const table = overlay ? UV2 : UV;
    const rects = arm && slimTable[part.id] ? slimTable[part.id] : table[part.id];

    const box = document.createElement('div');
    box.className = 'sk3-box';
    box.style.transform =
      `translate3d(${part.center[0] * px}px, ${part.center[1] * px}px, ${part.center[2] * px}px)`;

    const pad = 0;
    const W = (aw + pad * 2) * px;
    const H = (h + pad * 2) * px;
    const D = (d + pad * 2) * px;

    const push = overlay ? 0.02 : 0;
    box.appendChild(faceEl(url, rects.front, W, H, `translateZ(${D / 2 + push}px)`, LIGHT.front, overlay, px));
    box.appendChild(faceEl(url, rects.back, W, H, `rotateY(180deg) translateZ(${D / 2 + push}px)`, LIGHT.back, overlay, px));
    box.appendChild(faceEl(url, rects.right, D, H, `rotateY(90deg) translateZ(${W / 2 + push}px)`, LIGHT.right, overlay, px));
    box.appendChild(faceEl(url, rects.left, D, H, `rotateY(-90deg) translateZ(${W / 2 + push}px)`, LIGHT.left, overlay, px));
    box.appendChild(faceEl(url, rects.top, W, D, `rotateX(90deg) translateZ(${H / 2 + push}px)`, LIGHT.top, overlay, px));
    box.appendChild(faceEl(url, rects.bottom, W, D, `rotateX(-90deg) translateZ(${H / 2 + push}px)`, LIGHT.bottom, overlay, px));
    return box;
  }

  function pxScaleFor(host) {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return 6; // 页面还没显示时给个默认值
    // 模型宽 16、高 32 皮肤像素，四周留 15% 余量
    const byW = (rect.width * 0.72) / 16;
    const byH = (rect.height * 0.78) / 32;
    return Math.max(4, Math.min(12, Math.floor(Math.min(byW, byH))));
  }

  // 空闲时缓慢自转，鼠标拖拽时暂停
  function tick() {
    if (scene && !scene.dragging) {
      scene.rotY += 0.22;
      applyTransform();
    }
    requestAnimationFrame(tick);
  }

  function applyTransform() {
    if (!scene) return;
    scene.inner.style.transform =
      `rotateX(${scene.rotX}deg) rotateY(${scene.rotY}deg)`;
  }

  function render(host) {
    if (!scene || !scene.url) return;
    const px = pxScaleFor(host);
    host.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'sk3-inner';
    host.appendChild(inner);

    for (const part of PARTS) {
      inner.appendChild(buildBox(part, scene.url, scene.slim, false, px));
      inner.appendChild(buildBox(part, scene.url, scene.slim, true, px));
    }
    scene.inner = inner;
    scene.px = px;
    applyTransform();
  }

  let spinning = false;
  function build(host, textureUrl, variant) {
    if (!host) return;
    const slim = variant === 'slim';
    const same = scene && scene.host === host && scene.url === textureUrl && scene.slim === slim;
    if (!same) {
      scene = { host, url: textureUrl, slim, rotY: -26, rotX: -8, dragging: false, lastX: 0, lastY: 0, inner: null, px: 6 };
      bind(host);
    }
    host.classList.add('sk3-host');
    render(host);
    if (!spinning) { spinning = true; requestAnimationFrame(tick); }

    // 预览区尺寸变化时重建（窗口缩放、左侧栏展开等）
    if (!host.__sk3Observer && window.ResizeObserver) {
      host.__sk3Observer = new ResizeObserver(() => {
        if (!scene || scene.host !== host) return;
        const px = pxScaleFor(host);
        if (Math.abs(px - scene.px) >= 1) render(host);
      });
      host.__sk3Observer.observe(host);
    }
  }

  function bind(host) {
    host.onpointerdown = (e) => {
      if (!scene) return;
      scene.dragging = true;
      scene.lastX = e.clientX;
      scene.lastY = e.clientY;
      host.classList.add('dragging');
      try { host.setPointerCapture(e.pointerId); } catch (err) {}
    };
    host.onpointermove = (e) => {
      if (!scene || !scene.dragging) return;
      scene.rotY += (e.clientX - scene.lastX) * 0.55;
      scene.rotX = Math.max(-55, Math.min(55, scene.rotX - (e.clientY - scene.lastY) * 0.4));
      scene.lastX = e.clientX;
      scene.lastY = e.clientY;
      applyTransform();
    };
    host.onpointerup = host.onpointercancel = host.onpointerleave = () => {
      if (!scene) return;
      scene.dragging = false;
      host.classList.remove('dragging');
    };
    host.onwheel = (e) => {
      if (!scene) return;
      e.preventDefault();
      const next = Math.max(0.7, Math.min(1.6, (scene.zoom || 1) - Math.sign(e.deltaY) * 0.08));
      scene.zoom = next;
      if (scene.inner) scene.inner.style.zoom = next;
    };
    host.ondblclick = () => {
      if (!scene) return;
      scene.rotY = -26;
      scene.rotX = -8;
      if (scene.inner) scene.inner.style.zoom = 1;
      scene.zoom = 1;
      applyTransform();
    };
  }

  function clear(host) {
    if (host) {
      host.innerHTML = '';
      host.classList.remove('sk3-host');
    }
    scene = null;
  }

  window.Skin3D = { build, clear };
})();
