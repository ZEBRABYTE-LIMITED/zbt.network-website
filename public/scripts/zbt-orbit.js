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
  let desktopEmblems = [];
  let mobileEmblems = [];

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


  // Geodesic Poisson spacing preserves the continent silhouettes while keeping
  // the actual four-part ZebraByte emblem individually readable.
  function distributeLand(minDegrees) {
    const chord = 2 * Math.sin((minDegrees * RAD) / 2);
    const thresholdSquared = chord * chord;
    const buckets = new Map();
    const chosen = [];
    const indices = points.map((_, index) => index);
    // Fixed order so the layout never twinkles randomly between frames.
    indices.sort((a, b) =>
      (Math.imul(a + 1, 2654435761) >>> 0) -
      (Math.imul(b + 1, 2654435761) >>> 0)
    );

    for (const idx of indices) {
      const p = points[idx];
      const x = Math.floor((p[0] + 1) / chord);
      const y = Math.floor((p[1] + 1) / chord);
      const z = Math.floor((p[2] + 1) / chord);
      let tooClose = false;

      for (let dx = -1; dx <= 1 && !tooClose; dx++) {
        for (let dy = -1; dy <= 1 && !tooClose; dy++) {
          for (let dz = -1; dz <= 1 && !tooClose; dz++) {
            const bucket = buckets.get((x + dx) + ":" + (y + dy) + ":" + (z + dz));
            if (!bucket) continue;
            for (const q of bucket) {
              const d0 = p[0] - q[0], d1 = p[1] - q[1], d2 = p[2] - q[2];
              if (d0*d0 + d1*d1 + d2*d2 < thresholdSquared) {
                tooClose = true;
                break;
              }
            }
          }
        }
      }
      if (tooClose) continue;

      chosen.push(p);
      const key = x + ":" + y + ":" + z;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    return chosen;
  }

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, rect.width);
    const nextHeight = Math.max(1, rect.height);
    if (Math.abs(nextWidth - width) < 0.3 && Math.abs(nextHeight - height) < 0.3 && canvas.width) return;
    width = nextWidth;
    height = nextHeight;
    const scale = Math.min(window.devicePixelRatio || 1, smallScreen.matches ? 2.5 : 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    render();
  }


  function render() {
    if (!ready || !spriteReady) return;
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.5, cy = height * 0.5;
    const radius = Math.min(width, height) * .46;
    const cosLon = Math.cos(rotation), sinLon = Math.sin(rotation);
    const cosLat = Math.cos(latitude), sinLat = Math.sin(latitude);
    const mobile = smallScreen.matches;
    const glyphSize = Math.min(22, Math.max(13, radius * .073));
    const spacing = glyphSize * 1.14;
    const spacingSquared = spacing * spacing;
    const candidates = [];

    for (const p of mobile ? mobileEmblems : desktopEmblems) {
      const x = p[0] * cosLon - p[2] * sinLon;
      const forward = p[2] * cosLon + p[0] * sinLon;
      const y = p[1] * cosLat - forward * sinLat;
      const depth = p[1] * sinLat + forward * cosLat;
      if (depth <= .04) continue;

      candidates.push({
        x: cx + x * radius,
        y: cy - y * radius,
        depth
      });
    }

    // Prefer the near hemisphere where two projected marks would overlap.
    // Adjacent screen-space buckets eliminate clumps at the sphere's edge.
    candidates.sort((a, b) => b.depth - a.depth);
    const cells = new Map();
    for (const mark of candidates) {
      const ix = Math.floor(mark.x / spacing);
      const iy = Math.floor(mark.y / spacing);
      let occupied = false;
      for (let dx = -1; dx <= 1 && !occupied; dx++) {
        for (let dy = -1; dy <= 1 && !occupied; dy++) {
          const nearby = cells.get((ix + dx) + ":" + (iy + dy));
          if (!nearby) continue;
          for (const other of nearby) {
            const dX = mark.x - other.x, dY = mark.y - other.y;
            if (dX*dX + dY*dY < spacingSquared) {
              occupied = true;
              break;
            }
          }
        }
      }
      if (occupied) continue;
      const key = ix + ":" + iy;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(mark);

      const opacity = .55 + .41 * Math.sqrt(mark.depth);
      const size = glyphSize * (.89 + mark.depth * .11);
      ctx.globalAlpha = opacity;
      ctx.drawImage(sprite, mark.x - size / 2, mark.y - size / 2, size, size);
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
    desktopEmblems = distributeLand(3.8);
    mobileEmblems = distributeLand(6.4);
    points.length = 0;
    ready = true;
    if (spriteReady) holder.dataset.ready = "true";
    measure();
    sync();
  }).catch(error => {
    console.warn("ZebraByte abstract continent globe unavailable:", error);
    // Hero remains readable with its restrained static atmospheric fallback.
  });
})();
