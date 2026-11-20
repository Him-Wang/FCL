/* FCL · 3D 皮肤预览
 *
 * 双后端：
 *   1) 主后端 skinview3d（WebGL / Three.js）—— 与游戏内观感一致，支持 HD 皮肤、
 *      自动 slim 检测、披风、正确光照与 overlay。通过 assets/vendor/skinview3d.bundle.js
 *      （UMD，暴露 window.skinview3d）加载，无需打包器。
 *   2) 回退后端 CSS 3D —— WebGL 不可用（无 GPU / 老机器 / 被禁用）时自动降级，
 *      保留原有的 6 部件 × 6 面 × 双层结构。
 *
 * 对外 API 不变：Skin3D.build(host, url, variant, normalizer) / clear(host) / setView(rx, ry, host)
 *   normalizer 可选：(dataUrl, w, h) => Promise<dataUrl>，仅 CSS 后端用到。
 */
(function () {
  'use strict';

  var SV = (typeof window !== 'undefined' && window.skinview3d) || null;
  var _webglOK = null;

  /** WebGL + skinview3d 是否可用（只检测一次） */
  function canWebGL() {
    if (_webglOK !== null) return _webglOK;
    if (!SV || !SV.SkinViewer) return (_webglOK = false);
    try {
      var c = document.createElement('canvas');
      _webglOK = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
      _webglOK = false;
    }
    return _webglOK;
  }

  /* ==================== WebGL 后端（skinview3d） ==================== */
  var glInstances = new Map(); // host -> instance
  var _buildGen = new WeakMap(); // host -> 累加计数，CSS 异步归一化完成时校验，防止竞态
  var lastHost = null; // 最近一次 build 的 host，供省略 host 的 setView 使用

  function glDispose(host) {
    var inst = glInstances.get(host);
    if (!inst) return;
    try { inst.viewer.dispose(); } catch (e) {}
    try { if (inst.ro) inst.ro.disconnect(); } catch (e) {}
    glInstances.delete(host);
  }

  function glBuild(host, url, variant) {
    var model = variant === 'auto' ? 'auto-detect' : (variant === 'slim' ? 'slim' : 'default');
    var key = String(url) + '|' + model;
    var inst = glInstances.get(host);
    if (inst && inst.key === key) {
      host.classList.add('sk3-host');
      return true;
    }
    glDispose(host);
    host.innerHTML = '';
    var canvas = document.createElement('canvas');
    canvas.className = 'sk3-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    host.appendChild(canvas);
    var r = host.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width || 300));
    var h = Math.max(1, Math.round(r.height || 340));
    var viewer;
    try {
      viewer = new SV.SkinViewer({
        canvas: canvas, width: w, height: h, skin: url, model: model,
      });
    } catch (e) {
      return false; // 构建失败 -> 调用方回退 CSS
    }
    // skinview3d 官方默认：环境光 3.0 + 相机点光 0.6，纹理 NearestFilter、关调色板管理
    try { viewer.globalLight.intensity = 3.0; } catch (e) {}
    try { viewer.cameraLight.intensity = 0.6; } catch (e) {}
    inst = { key: key, viewer: viewer, canvas: canvas, url: url, variant: variant, ro: null, w: w, h: h };
    glInstances.set(host, inst);
    host.classList.add('sk3-host');

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        var rr = host.getBoundingClientRect();
        var nw = Math.max(1, Math.round(rr.width));
        var nh = Math.max(1, Math.round(rr.height));
        if ((nw !== inst.w || nh !== inst.h) && nw && nh) {
          try { viewer.setSize(nw, nh); } catch (e) {}
          inst.w = nw; inst.h = nh;
        }
      });
      ro.observe(host);
      inst.ro = ro;
    }
    return true;
  }

  function glSetView(host, rx, ry) {
    var inst = glInstances.get(host);
    if (!inst) return false;
    try {
      var v = inst.viewer, cam = v.camera;
      var dist = cam.position.length() || 60;
      var yaw = (ry || 0) * Math.PI / 180;
      var pitch = (rx || 0) * Math.PI / 180;
      cam.position.set(
        dist * Math.sin(yaw) * Math.cos(pitch),
        dist * Math.sin(pitch),
        dist * Math.cos(yaw) * Math.cos(pitch)
      );
      cam.lookAt(0, 0, 0);
      if (v.controls) { v.controls.target.set(0, 0, 0); v.controls.update(); }
      v.render();
      return true;
    } catch (e) { return false; }
  }

  /* ==================== CSS 3D 回退后端 ====================
   * 键名 right/left 指「角色自己的右/左」：right 面在几何 -x（面对角色时在屏幕左侧），
   * left 面在几何 +x。与 skinview3d setUVs 的 +X/-X 列一致。
   */
  var UV = {
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
  var UV2 = {
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
  var SLIM_UV = {
    armR: {
      top: [44, 16, 3, 4], bottom: [47, 16, 3, 4], right: [40, 20, 4, 12],
      front: [44, 20, 3, 12], left: [47, 20, 4, 12], back: [51, 20, 3, 12],
    },
    armL: {
      top: [36, 48, 3, 4], bottom: [39, 48, 3, 4], right: [32, 52, 4, 12],
      front: [36, 52, 3, 12], left: [39, 52, 4, 12], back: [43, 52, 3, 12],
    },
  };
  var SLIM_UV2 = {
    armR: {
      top: [44, 32, 3, 4], bottom: [47, 32, 3, 4], right: [40, 36, 4, 12],
      front: [44, 36, 3, 12], left: [47, 36, 4, 12], back: [51, 36, 3, 12],
    },
    armL: {
      top: [52, 48, 3, 4], bottom: [55, 48, 3, 4], right: [48, 52, 4, 12],
      front: [52, 52, 3, 12], left: [55, 52, 4, 12], back: [59, 52, 3, 12],
    },
  };
  var PARTS = [
    { id: 'head', size: [8, 8, 8], outer: [9, 9, 9], center: [0, -10, 0] },
    { id: 'body', size: [8, 12, 4], outer: [8.5, 12.5, 4.5], center: [0, 0, 0] },
    { id: 'armR', size: [4, 12, 4], outer: [4.5, 12.5, 4.5], center: [-6, 0, 0] },
    { id: 'armL', size: [4, 12, 4], outer: [4.5, 12.5, 4.5], center: [6, 0, 0] },
    { id: 'legR', size: [4, 12, 4], outer: [4.5, 12.5, 4.5], center: [-2, 12, 0] },
    { id: 'legL', size: [4, 12, 4], outer: [4.5, 12.5, 4.5], center: [2, 12, 0] },
  ];
  var LIGHT = { front: 1.0, back: 0.88, right: 0.86, left: 0.74, top: 1.14, bottom: 0.6 };
  var TEX_W = 64, TEX_H = 64;

  var cssScene = null, cssRaf = 0, cssLast = 0;

  function faceEl(url, rect, w, h, transform, light, overlay) {
    var sx = rect[0], sy = rect[1], sw = rect[2], sh = rect[3];
    var el = document.createElement('div');
    el.className = 'sk3-face' + (overlay ? ' sk3-over' : '');
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = (-w / 2) + 'px';
    el.style.top = (-h / 2) + 'px';
    var scX = w / sw, scY = h / sh;
    el.style.backgroundImage = 'url("' + url + '")';
    el.style.backgroundSize = (TEX_W * scX) + 'px ' + (TEX_H * scY) + 'px';
    el.style.backgroundPosition = (-sx * scX) + 'px ' + (-sy * scY) + 'px';
    el.style.filter = 'brightness(' + light + ')';
    el.style.transform = transform;
    return el;
  }

  function buildBox(part, url, slim, overlay, px) {
    var arm = slim && (part.id === 'armR' || part.id === 'armL');
    var dims = overlay ? part.outer : part.size;
    var w = dims[0], h = dims[1], d = dims[2];
    if (arm) w = overlay ? 3.5 : 3;
    var table = overlay ? SLIM_UV2 : SLIM_UV;
    var base = overlay ? UV2 : UV;
    var rects = arm && table[part.id] ? table[part.id] : base[part.id];
    var armCenterX = arm ? (part.id === 'armR' ? -5.5 : 5.5) : part.center[0];

    var box = document.createElement('div');
    box.className = 'sk3-box';
    box.style.transform =
      'translate3d(' + (armCenterX * px) + 'px, ' + (part.center[1] * px) + 'px, ' + (part.center[2] * px) + 'px)';

    var W = w * px, H = h * px, D = d * px;
    box.appendChild(faceEl(url, rects.front, W, H, 'translateZ(' + (D / 2) + 'px)', LIGHT.front, overlay));
    box.appendChild(faceEl(url, rects.back, W, H, 'rotateY(180deg) translateZ(' + (D / 2) + 'px)', LIGHT.back, overlay));
    box.appendChild(faceEl(url, rects.left, D, H, 'rotateY(90deg) translateZ(' + (W / 2) + 'px)', LIGHT.left, overlay));
    box.appendChild(faceEl(url, rects.right, D, H, 'rotateY(-90deg) translateZ(' + (W / 2) + 'px)', LIGHT.right, overlay));
    box.appendChild(faceEl(url, rects.top, W, D, 'rotateX(90deg) translateZ(' + (H / 2) + 'px)', LIGHT.top, overlay));
    box.appendChild(faceEl(url, rects.bottom, W, D, 'rotateX(-90deg) translateZ(' + (H / 2) + 'px)', LIGHT.bottom, overlay));
    return box;
  }

  function pxScaleFor(host) {
    var rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return 6;
    var byW = (rect.width * 0.72) / 16;
    var byH = (rect.height * 0.78) / 32;
    return Math.max(4, Math.min(12, Math.floor(Math.min(byW, byH))));
  }

  function cssTick(t) {
    cssRaf = requestAnimationFrame(cssTick);
    if (!cssLast) cssLast = t;
    var dt = Math.min(100, t - cssLast);
    cssLast = t;
    if (cssScene && !cssScene.dragging && !document.hidden) {
      cssScene.rotY += dt * 0.012;
      cssApply();
    }
  }
  function cssStartSpin() { if (!cssRaf) { cssLast = 0; cssRaf = requestAnimationFrame(cssTick); } }
  function cssStopSpin() { if (cssRaf) { cancelAnimationFrame(cssRaf); cssRaf = 0; } }
  function cssApply() {
    if (!cssScene || !cssScene.inner) return;
    var z = cssScene.zoom || 1;
    cssScene.inner.style.transform =
      'scale(' + z + ') rotateX(' + cssScene.rotX + 'deg) rotateY(' + cssScene.rotY + 'deg)';
  }
  function cssRender(host) {
    if (!cssScene || !cssScene.url) return;
    var px = pxScaleFor(host);
    host.innerHTML = '';
    var inner = document.createElement('div');
    inner.className = 'sk3-inner';
    host.appendChild(inner);
    for (var i = 0; i < PARTS.length; i++) {
      inner.appendChild(buildBox(PARTS[i], cssScene.url, cssScene.slim, false, px));
      inner.appendChild(buildBox(PARTS[i], cssScene.url, cssScene.slim, true, px));
    }
    cssScene.inner = inner;
    cssScene.px = px;
    try { host.style.setProperty('--sk3-feet', (px * 16) + 'px'); } catch (e) {}
    cssApply();
  }
  function cssBuild(host, url, variant, normalizer) {
    if (!host) return;
    var slim = variant === 'slim';
    var same = cssScene && cssScene.host === host && cssScene.url === url && cssScene.slim === slim;
    if (!same) {
      cssScene = {
        host: host, url: url, slim: slim, rotY: -26, rotX: -8, zoom: 1,
        dragging: false, lastX: 0, lastY: 0, inner: null, px: 6,
      };
      cssBind(host);
    }
    host.classList.add('sk3-host');
    cssRender(host);
    cssStartSpin();
    if (!host.__sk3Observer && window.ResizeObserver) {
      host.__sk3Observer = new ResizeObserver(function () {
        if (!cssScene || cssScene.host !== host) return;
        var px = pxScaleFor(host);
        if (Math.abs(px - cssScene.px) >= 1) cssRender(host);
      });
      host.__sk3Observer.observe(host);
    }
  }
  function cssBind(host) {
    host.onpointerdown = function (e) {
      if (!cssScene) return;
      cssScene.dragging = true;
      cssScene.lastX = e.clientX;
      cssScene.lastY = e.clientY;
      host.classList.add('dragging');
      try { host.setPointerCapture(e.pointerId); } catch (err) {}
    };
    host.onpointermove = function (e) {
      if (!cssScene || !cssScene.dragging) return;
      cssScene.rotY += (e.clientX - cssScene.lastX) * 0.5;
      cssScene.rotX = Math.max(-55, Math.min(55, cssScene.rotX - (e.clientY - cssScene.lastY) * 0.5));
      cssScene.lastX = e.clientX;
      cssScene.lastY = e.clientY;
      cssApply();
    };
    host.onpointerup = host.onpointercancel = host.onpointerleave = function () {
      if (!cssScene) return;
      cssScene.dragging = false;
      host.classList.remove('dragging');
    };
    host.onwheel = function (e) {
      if (!cssScene) return;
      e.preventDefault();
      cssScene.zoom = Math.max(0.6, Math.min(2.0, cssScene.zoom - Math.sign(e.deltaY) * 0.08));
      cssApply();
    };
    host.ondblclick = function () {
      if (!cssScene) return;
      cssScene.rotY = -26;
      cssScene.rotX = -8;
      cssScene.zoom = 1;
      cssApply();
    };
  }
  function cssClear(host) {
    cssStopSpin();
    if (host) {
      host.innerHTML = '';
      host.classList.remove('sk3-host', 'dragging');
      host.style.removeProperty('--sk3-feet');
    }
    cssScene = null;
  }
  function cssSetView(rx, ry) {
    if (!cssScene) return false;
    if (typeof rx === 'number') cssScene.rotX = rx;
    if (typeof ry === 'number') cssScene.rotY = ry;
    cssScene.dragging = true;
    cssApply();
    return true;
  }

  /** CSS 后端的默认归一化（无外部 normalizer 时用）：64×32 升格为 64×64 */
  function defaultNormalizer(dataUrl, w, h) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onerror = function () { resolve(dataUrl); };
      img.onload = function () {
        if (w === 64 && h === 64) { resolve(dataUrl); return; }
        try {
          var c = document.createElement('canvas');
          c.width = 64; c.height = 64;
          var x = c.getContext('2d');
          x.imageSmoothingEnabled = false;
          if (h * 2 === w) {
            x.drawImage(img, 0, 0, w, h, 0, 0, 64, 32);
            x.save(); x.scale(-1, 1);
            var cp = function (sx, sy, sw, sh, dx, dy) { x.drawImage(c, sx, sy, sw, sh, -dx, dy, -sw, sh); };
            cp(4,16,4,4,20,48); cp(8,16,4,4,24,48);
            cp(0,20,4,12,24,52); cp(4,20,4,12,20,52); cp(8,20,4,12,16,52); cp(12,20,4,12,28,52);
            cp(44,16,4,4,36,48); cp(48,16,4,4,40,48);
            cp(40,20,4,12,40,52); cp(44,20,4,12,36,52); cp(48,20,4,12,32,52); cp(52,20,4,12,44,52);
            x.restore();
          } else {
            x.drawImage(img, 0, 0, w, h, 0, 0, 64, 64);
          }
          resolve(c.toDataURL('image/png'));
        } catch (e) { resolve(dataUrl); }
      };
      img.src = dataUrl;
    });
  }
  function cssNormalizeIfNeeded(url, normalizer) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onerror = function () { resolve(url); };
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (w === 64 && h === 64) { resolve(url); return; }
        (normalizer || defaultNormalizer)(url, w, h).then(resolve, function () { resolve(url); });
      };
      img.src = url;
    });
  }

  /* ==================== 对外 API（分派） ==================== */
  function build(host, url, variant, normalizer) {
    if (!host) return;
    lastHost = host;
    var gen = (_buildGen.get(host) || 0) + 1;
    _buildGen.set(host, gen);
    if (canWebGL()) {
      if (glBuild(host, url, variant)) return;
      glDispose(host); // WebGL 构建失败 -> 回退
    }
    cssNormalizeIfNeeded(url, normalizer).then(function (nurl) {
      if (gen !== _buildGen.get(host) || !document.contains(host)) return; // 期间切走了
      cssBuild(host, nurl, variant, normalizer);
    });
  }
  function clear(host) {
    glDispose(host);
    cssClear(host);
    try { host.classList.remove('sk3-host', 'dragging'); host.innerHTML = ''; } catch (e) {}
  }
  function setView(rx, ry, host) {
    host = host || lastHost;
    if (!host) return false;
    if (glInstances.has(host)) return glSetView(host, rx, ry);
    return cssSetView(rx, ry);
  }
  function usesWebGL() { return canWebGL(); }

  window.Skin3D = { build: build, clear: clear, setView: setView, usesWebGL: usesWebGL };
})();
