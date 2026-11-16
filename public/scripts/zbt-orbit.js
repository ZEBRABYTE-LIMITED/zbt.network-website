(() => {
  "use strict";

  const canvas = document.getElementById("zbt-globe");
  const ctx = canvas?.getContext?.("2d", { alpha: true, desynchronized: true });
  if (!canvas || !ctx) return;

  const holder = canvas.parentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const smallScreen = window.matchMedia("(max-width: 760px)");
  const RAD = Math.PI / 180;
  const sprite = new Image();
  sprite.decoding = "async";
  const points = [];

  let width = 1, height = 1, ready = false, spriteReady = false;
  let rotation = 8 * RAD, latitude = 14 * RAD;
  let frame = 0, previousTime = 0, previousRender = 0;
  let visible = true, dragging = false, pointerX = 0, pointerY = 0;

  // All points are on actual land. The ocean deliberately contains no symbols.
  // Natural Earth 1:50m is public-domain geographic data.
  function decodeLand(text) {
    let i = 0, lon = 0, lat = 0;
    while (i < text.length) {
      let values = [];
      for (let n = 0; n < 2; n++) {
        let value = 0, shift = 0, part;
        do {
          if (i >= text.length) throw new Error("Truncated land pattern");
          part = text.charCodeAt(i++) - 63;
          value |= (part & 31) << shift;
          shift += 5;
        } while (part >= 32);
        values.push((value & 1) ? ~(value >> 1) : value >> 1);
      }
      lon += values[0];
      lat += values[1];
      const lambda = (lon / 100) * RAD, phi = (lat / 100) * RAD;
      const cosPhi = Math.cos(phi);
      points.push([cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)]);
    }
  }

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, rect.width);
    const nextHeight = Math.max(1, rect.height);
    if (Math.abs(nextWidth - width) < 0.3 && Math.abs(nextHeight - height) < 0.3 && canvas.width) return;
    width = nextWidth;
    height = nextHeight;
    const scale = Math.min(window.devicePixelRatio || 1, smallScreen.matches ? 1.25 : 1.75);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    render();
  }

  function render() {
    if (!ready || !spriteReady) return;
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.5, cy = height * 0.5;
    const r = Math.min(width, height) * .46;
    const cLon = Math.cos(rotation), sLon = Math.sin(rotation);
    const cLat = Math.cos(latitude), sLat = Math.sin(latitude);

    // An atmospheric glow conveys volume without drawing an opaque ocean map.
    const glow = ctx.createRadialGradient(cx - r * .2, cy - r * .12, r * .04, cx, cy, r * 1.05);
    glow.addColorStop(0, "rgba(99,78,152,.13)");
    glow.addColorStop(.63, "rgba(77,55,128,.05)");
    glow.addColorStop(1, "rgba(15,13,23,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.04, 0, Math.PI * 2);
    ctx.fill();

    // The globe texture is a projection of the ZebraByte emblem onto continents.
    // Do NOT draw the symbols at any coordinates in the sea.
    const size = Math.min(18, Math.max(7, r * .023));
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = p[0] * cLon - p[2] * sLon;
      const front = p[2] * cLon + p[0] * sLon;
      const y = p[1] * cLat - front * sLat;
      const depth = p[1] * sLat + front * cLat;
      if (depth <= .028) continue;

      const rim = Math.pow(depth, .65);
      const variation = .79 + .21 * Math.sin(i * .48) * Math.sin(i * .17 + 1.3);
      const opacity = (.16 + .73 * rim) * variation;
      const s = size * (.64 + depth * .38);
      const px = cx + x * r, py = cy - y * r;
      ctx.globalAlpha = Math.max(.10, Math.min(.92, opacity));
      ctx.drawImage(sprite, px - s * .5, py - s * .5, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    previousRender = 0;
  }

  function tick(now) {
    frame = 0;
    if (!visible || reducedMotion.matches || document.hidden) return;
    const dt = previousTime ? Math.min(.065, (now - previousTime) / 1000) : 0;
    previousTime = now;
    if (!dragging) rotation += dt * .065;
    const interval = smallScreen.matches ? 66 : 38;
    if (now - previousRender >= interval) {
      render();
      previousRender = now;
    }
    frame = window.requestAnimationFrame(tick);
  }

  function sync() {
    stop();
    render();
    if (ready && spriteReady && visible && !reducedMotion.matches && !document.hidden) {
      frame = window.requestAnimationFrame(tick);
    }
  }

  canvas.addEventListener("pointerdown", event => {
    if (smallScreen.matches || reducedMotion.matches) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!dragging) return;
    rotation -= (event.clientX - pointerX) * .003;
    latitude = Math.max(-.85, Math.min(.85, latitude + (event.clientY - pointerY) * .002));
    pointerX = event.clientX;
    pointerY = event.clientY;
    render();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(event, () => { dragging = false; });
  }

  new ResizeObserver(measure).observe(canvas);
  new IntersectionObserver(entries => {
    visible = !!entries[0]?.isIntersecting;
    sync();
  }, { rootMargin: "100px" }).observe(holder);
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener?.("change", sync);

  Promise.all([
    fetch("/data/zbt-continent-dots.json", { cache: "force-cache" }).then(res => {
      if (!res.ok) throw new Error("Continental symbol mask: " + res.status);
      return res.json();
    }),
    new Promise(resolve => {
      sprite.onload = () => { spriteReady = true; resolve(); };
      sprite.onerror = () => resolve();
      sprite.src = "/assets/zebrabyte-glyph.svg";
    })
  ]).then(([data]) => {
    if (typeof data.polyline !== "string" || data.points < 1000) throw new Error("Invalid continent mask");
    decodeLand(data.polyline);
    if (points.length !== data.points) throw new Error("Incomplete land pattern");
    ready = true;
    if (spriteReady) holder.dataset.ready = "true";
    measure();
    sync();
  }).catch(error => {
    console.warn("ZebraByte abstract continent globe unavailable:", error);
    // Hero remains readable with its restrained static atmospheric fallback.
  });
})();
