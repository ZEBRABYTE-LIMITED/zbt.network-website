(() => {
  "use strict";
  const canvas = document.getElementById("zbt-globe");
  const ctx = canvas?.getContext?.("2d", { alpha: true, desynchronized: true });
  if (!canvas || !ctx) return;
  const holder = canvas.parentElement;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compact = window.matchMedia("(max-width: 760px)");
  const glyph = new Image();
  glyph.decoding = "async";
  let ready = false, width = 1, height = 1, yaw = -.32, tilt = -.18;
  let pointerDown = false, lastX = 0, lastY = 0, active = true;
  let raf = 0, previousTime = 0, previousDraw = 0;

  // A mathematically projected spherical lattice of ZebraByte monograms.
  // This is intentionally abstract: no geographic maps, borders or countries.
  const points = [];
  for (let lat = -81, row = 0; lat <= 81; lat += 3.15, row++) {
    const phi = lat * Math.PI / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let lon = -180; lon < 180; lon += 3.15) {
      const lambda = (lon + (row % 2 ? 1.57 : 0)) * Math.PI / 180;
      points.push([cosPhi * Math.sin(lambda), sinPhi, cosPhi * Math.cos(lambda), row]);
    }
  }
  function measure() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(compact.matches ? 1.4 : 1.8, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function draw() {
    if (!ready) return;
    ctx.clearRect(0, 0, width, height);
    const r = Math.min(width, height) * .467;
    const cx = width / 2, cy = height / 2;
    const sy = Math.sin(yaw), cyaw = Math.cos(yaw);
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    const iconSize = Math.max(9, r * .027);
    const stride = compact.matches ? 2 : 1;
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      const x = p[0] * cyaw + p[2] * sy;
      const depth = p[2] * cyaw - p[0] * sy;
      if (depth <= .06) continue;
      const dx = x * ct - p[1] * st;
      const dy = x * st + p[1] * ct;
      const fade = Math.pow(depth, .82);
      const size = iconSize * (.63 + .36 * depth);
      const px = cx + dx * r, py = cy + dy * r;
      // Subtle procedural tone variation prevents the repetitive pattern from
      // looking like a flat sheet pasted onto a circle.
      const shimmer = .75 + .25 * Math.sin(i * .52 + yaw * .6);
      ctx.globalAlpha = (.11 + .53 * fade) * shimmer;
      ctx.drawImage(glyph, px - size/2, py - size/2, size, size);
    }
    ctx.globalAlpha = 1;
  }
  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    previousTime = 0;
    previousDraw = 0;
  }
  function tick(now) {
    raf = 0;
    if (!active || motion.matches || document.hidden) return;
    const dt = previousTime ? Math.min(.08, (now - previousTime)/1000) : 0;
    previousTime = now;
    if (!pointerDown) yaw += dt * .13;
    const cadence = compact.matches ? 62 : 40;
    if (now - previousDraw > cadence) {
      draw();
      previousDraw = now;
    }
    raf = window.requestAnimationFrame(tick);
  }
  function sync() {
    stop();
    draw();
    if (active && ready && !motion.matches && !document.hidden) {
      raf = window.requestAnimationFrame(tick);
    }
  }
  canvas.addEventListener("pointerdown", e => {
    if (compact.matches || motion.matches) return;
    pointerDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if (!pointerDown) return;
    yaw += (e.clientX - lastX) * .004;
    tilt = Math.max(-.75, Math.min(.75, tilt + (e.clientY - lastY) * .0018));
    lastX = e.clientX;
    lastY = e.clientY;
    draw();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(name, () => { pointerDown = false; });
  }
  new ResizeObserver(measure).observe(canvas);
  new IntersectionObserver(entries => {
    active = !!entries[0]?.isIntersecting;
    sync();
  }, {rootMargin: "100px"}).observe(holder);
  document.addEventListener("visibilitychange", sync);
  motion.addEventListener?.("change", sync);
  glyph.onload = () => {
    ready = true;
    holder.dataset.ready = "true";
    measure();
    sync();
  };
  glyph.src = "/assets/zebrabyte-glyph.svg";
})();