(() => {
  "use strict";
  const canvas = document.getElementById("zbt-globe");
  const ctx = canvas?.getContext?.("2d", { alpha: true });
  if (!canvas || !ctx) return;
  const holder = canvas.parentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const points = Array.from({ length: 1320 }, (_, i) => {
    const y = 1 - (i + .5) * 2 / 1320;
    const r = Math.sqrt(1 - y * y);
    const t = i * Math.PI * (3 - Math.sqrt(5));
    return [r * Math.cos(t), y, r * Math.sin(t)];
  });
  const sprite = new Image();
  sprite.decoding = "async";
  let width = 0, height = 0, yaw = -.3, tilt = .12;
  let raf = 0, previousTime = 0, active = true, ready = false, dragging = false, px = 0, py = 0;
  const draw = () => {
    if (!ready || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const r = Math.min(width, height) * .455;
    const base = Math.min(18, Math.max(10, r * .038));
    const sy = Math.sin(yaw), cy = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
    const cx = width / 2, cyy = height / 2;
    for (const [xx, yy, zz] of points) {
      const x = xx * cy + zz * sy;
      const z1 = zz * cy - xx * sy;
      const y = yy * ct - z1 * st;
      const z = yy * st + z1 * ct;
      if (z < .04) continue;
      const s = base * (.64 + z * .48);
      const perspective = 1 + z * .08;
      ctx.globalAlpha = .18 + .75 * Math.pow(z, .8);
      ctx.drawImage(sprite, cx + x * r * perspective - s/2, cyy + y * r * perspective - s/2, s, s);
    }
    ctx.globalAlpha = 1;
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; previousTime = 0; };
  const tick = now => {
    raf = 0;
    const seconds = previousTime ? Math.min(.05, (now - previousTime)/1000) : 0;
    previousTime = now;
    if (!dragging) yaw += seconds * .19;
    draw();
    if (ready && active && !reduced.matches && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const sync = () => {
    stop();
    draw();
    if (ready && active && !reduced.matches && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const measure = () => {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };
  canvas.addEventListener("pointerdown", e => {
    if (reduced.matches) return;
    dragging = true; px = e.clientX; py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if (!dragging) return;
    yaw += (e.clientX - px) * .006;
    tilt = Math.max(-.7, Math.min(.7, tilt - (e.clientY - py) * .0025));
    px = e.clientX; py = e.clientY; draw();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, () => { dragging = false; });
  }
  new ResizeObserver(measure).observe(canvas);
  new IntersectionObserver(entries => {
    active = !!entries[0]?.isIntersecting;
    sync();
  }, { rootMargin: "100px" }).observe(holder);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener?.("change", sync);
  sprite.onload = () => {
    ready = true; holder.dataset.ready = "true"; measure(); sync();
  };
  sprite.src = "/assets/zebrabyte-mark.svg";
})();