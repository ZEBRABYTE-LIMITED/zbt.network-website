(() => {
  "use strict";

  const canvas = document.getElementById("zbt-globe");
  if (!canvas || typeof canvas.getContext !== "function") return;
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return;

  const holder = canvas.parentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const smallScreen = window.matchMedia("(max-width: 640px)");
  const RAD = Math.PI / 180;

  let countries = [];
  let landDots = [];
  let geographyReady = false;
  let markReady = false;
  const mark = new Image();
  mark.decoding = "async";

  let w = 1, h = 1, dpr = 1;
  let centerLon = 13, centerLat = 47;
  let visible = true, dragging = false, dragX = 0, dragY = 0;
  let animationId = 0, previousTime = 0, previousFrame = 0;

  // Google encoded polyline; coordinates are longitude,latitude, precision 1/100 degree.
  function decodePolyline(text) {
    const points = [];
    let i = 0, lon = 0, lat = 0;
    while (i < text.length) {
      const values = [];
      for (let n = 0; n < 2; n++) {
        let result = 0, shift = 0, part;
        do {
          if (i >= text.length) throw new Error("Invalid geographic polyline");
          part = text.charCodeAt(i++) - 63;
          result |= (part & 31) << shift;
          shift += 5;
        } while (part >= 32);
        values.push(result & 1 ? ~(result >> 1) : result >> 1);
      }
      lon += values[0];
      lat += values[1];
      points.push([lon / 100, lat / 100]);
    }
    return points;
  }

  // Cache geographic trigonometry once; only the globe orientation changes per frame.
  function geoPoint(lon, lat) {
    const phi = lat * RAD;
    const lambda = lon * RAD;
    return [Math.sin(phi), Math.cos(phi), Math.sin(lambda), Math.cos(lambda)];
  }

  function projectionState() {
    return [
      Math.cos(centerLon * RAD),
      Math.sin(centerLon * RAD),
      Math.sin(centerLat * RAD),
      Math.cos(centerLat * RAD)
    ];
  }

  function project(v, rotation, cx, cy, radius) {
    const cosDelta = v[3] * rotation[0] + v[2] * rotation[1];
    const sinDelta = v[2] * rotation[0] - v[3] * rotation[1];
    const x = v[1] * sinDelta;
    const y = rotation[3] * v[0] - rotation[2] * v[1] * cosDelta;
    const z = rotation[2] * v[0] + rotation[3] * v[1] * cosDelta;
    return [cx + x * radius, cy - y * radius, z];
  }

  function horizon(a, b, rotation, cx, cy, radius) {
    // The polygons are already simplified and vertices are close; geographic
    // interpolation gives a stable clipped point at the visible limb.
    let low = 0, high = 1;
    const lon1 = a[0], lat1 = a[1];
    let lonDelta = b[0] - lon1;
    if (lonDelta > 180) lonDelta -= 360;
    if (lonDelta < -180) lonDelta += 360;
    const aVisible = project(geoPoint(lon1, lat1), rotation, cx, cy, radius)[2] >= 0;
    let projected = null;
    for (let i = 0; i < 13; i++) {
      const t = (low + high) / 2;
      projected = project(
        geoPoint(lon1 + lonDelta * t, lat1 + (b[1] - lat1) * t),
        rotation, cx, cy, radius
      );
      if ((projected[2] >= 0) === aVisible) low = t;
      else high = t;
    }
    return projected;
  }

  function appendVisibleRing(path, ring, rotation, cx, cy, radius) {
    if (ring.length < 4) return;
    let prevRaw = ring[0].raw;
    let prev = project(ring[0].v, rotation, cx, cy, radius);
    let started = false;
    for (let i = 1; i < ring.length; i++) {
      const currentRaw = ring[i].raw;
      const now = project(ring[i].v, rotation, cx, cy, radius);
      const wasVisible = prev[2] >= 0;
      const isVisible = now[2] >= 0;

      if (wasVisible && isVisible) {
        if (!started) { path.moveTo(prev[0], prev[1]); started = true; }
        path.lineTo(now[0], now[1]);
      } else if (wasVisible !== isVisible) {
        const edge = horizon(prevRaw, currentRaw, rotation, cx, cy, radius);
        if (wasVisible) {
          if (!started) { path.moveTo(prev[0], prev[1]); started = true; }
          path.lineTo(edge[0], edge[1]);
          path.closePath();
          started = false;
        } else {
          path.moveTo(edge[0], edge[1]);
          path.lineTo(now[0], now[1]);
          started = true;
        }
      }
      prev = now;
      prevRaw = currentRaw;
    }
    if (started) path.closePath();
  }

  function drawGraticule(rotation, cx, cy, radius) {
    context.lineWidth = Math.max(.65, radius / 520);
    context.strokeStyle = "rgba(170,145,244,.14)";
    for (let lon = -180; lon < 180; lon += 20) {
      context.beginPath();
      let open = false;
      for (let lat = -85; lat <= 85; lat += 3) {
        const p = project(geoPoint(lon, lat), rotation, cx, cy, radius);
        if (p[2] < 0) { open = false; continue; }
        if (!open) context.moveTo(p[0], p[1]);
        else context.lineTo(p[0], p[1]);
        open = true;
      }
      context.stroke();
    }
    for (let lat = -60; lat <= 80; lat += 20) {
      context.beginPath();
      let open = false;
      for (let lon = -180; lon <= 180; lon += 3) {
        const p = project(geoPoint(lon, lat), rotation, cx, cy, radius);
        if (p[2] < 0) { open = false; continue; }
        if (!open) context.moveTo(p[0], p[1]);
        else context.lineTo(p[0], p[1]);
        open = true;
      }
      context.stroke();
    }
  }

  function drawGeography(rotation, cx, cy, radius) {
    for (const country of countries) {
      const path = new Path2D();
      for (const ring of country.rings) appendVisibleRing(path, ring, rotation, cx, cy, radius);
      const focus = country.code === "GBR" || country.code === "ITA";
      context.fillStyle = focus ? "rgba(145,117,221,.82)" : "rgba(76,64,120,.76)";
      context.fill(path);
      context.lineWidth = focus ? 1.45 : Math.max(.55, radius / 670);
      context.strokeStyle = focus ? "rgba(220,202,255,.93)" : "rgba(162,143,220,.53)";
      context.stroke(path);
    }
  }

  function drawLandTexture(rotation, cx, cy, radius) {
    const base = smallScreen.matches ? Math.max(2.4, radius * .016) : Math.max(3.0, radius * .016);
    // On a phone, drop every second point. Map silhouettes always keep full detail.
    const stride = smallScreen.matches ? 2 : 1;
    for (let i = 0; i < landDots.length; i += stride) {
      const p = project(landDots[i], rotation, cx, cy, radius);
      if (p[2] <= .06) continue;
      const alpha = .13 + .47 * Math.pow(p[2], .7);
      context.globalAlpha = alpha;
      const size = base * (.70 + p[2] * .34);
      if (markReady) {
        context.drawImage(mark, p[0] - size / 2, p[1] - size / 2, size, size);
      } else {
        context.fillStyle = "#b8a2ff";
        context.fillRect(p[0] - 1.0, p[1] - 1.0, 2.0, 2.0);
      }
    }
    context.globalAlpha = 1;
  }

  function drawLocation(name, lon, lat, rotation, cx, cy, radius, dy) {
    const p = project(geoPoint(lon, lat), rotation, cx, cy, radius);
    if (p[2] <= .22) return;
    const fontSize = smallScreen.matches ? 9 : 10.5;
    context.font = "600 " + fontSize + "px Arial, Helvetica, sans-serif";
    const tw = context.measureText(name).width;
    const x = p[0] + 10;
    const y = p[1] + dy;
    const pad = 7;
    context.fillStyle = "rgba(15,12,27,.9)";
    context.beginPath();
    context.roundRect(x - pad, y - fontSize - 5, tw + pad * 2, fontSize + 11, 5);
    context.fill();
    context.fillStyle = "rgba(235,223,255,.97)";
    context.fillText(name, x, y + 1);
    context.beginPath();
    context.arc(p[0], p[1], smallScreen.matches ? 2.7 : 3.2, 0, Math.PI * 2);
    context.fillStyle = "#d5beff";
    context.fill();
  }

  function draw() {
    if (!geographyReady) return;
    context.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) * .455;
    const rotation = projectionState();

    const halo = context.createRadialGradient(cx, cy, radius * .38, cx, cy, radius * 1.18);
    halo.addColorStop(0, "rgba(126,91,208,.12)");
    halo.addColorStop(.66, "rgba(118,86,189,.11)");
    halo.addColorStop(1, "rgba(15,12,29,0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(cx, cy, radius * 1.18, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();

    const ocean = context.createRadialGradient(
      cx - radius * .32, cy - radius * .36, radius * .05, cx, cy, radius * 1.13
    );
    ocean.addColorStop(0, "#2a2147");
    ocean.addColorStop(.62, "#181329");
    ocean.addColorStop(1, "#0d0a19");
    context.fillStyle = ocean;
    context.fillRect(cx - radius, cy - radius, 2 * radius, 2 * radius);

    drawGraticule(rotation, cx, cy, radius);
    drawGeography(rotation, cx, cy, radius);
    drawLandTexture(rotation, cx, cy, radius);

    const shade = context.createRadialGradient(
      cx - radius * .24, cy - radius * .32, radius * .11, cx, cy, radius
    );
    shade.addColorStop(0, "rgba(255,255,255,.09)");
    shade.addColorStop(.52, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(5,4,15,.58)");
    context.fillStyle = shade;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    drawLocation("UK", -0.127, 51.508, rotation, cx, cy, radius, -13);
    drawLocation("ITALIA", 12.496, 41.902, rotation, cx, cy, radius, 23);

    context.restore();
    context.lineWidth = Math.max(1.1, radius / 350);
    context.strokeStyle = "rgba(154,130,231,.34)";
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function stop() {
    if (animationId) window.cancelAnimationFrame(animationId);
    animationId = 0;
    previousTime = 0;
    previousFrame = 0;
  }

  function tick(now) {
    animationId = 0;
    if (!visible || reducedMotion.matches || document.hidden) return;
    const elapsed = previousTime ? Math.min(.07, (now - previousTime) / 1000) : 0;
    previousTime = now;
    if (!dragging) centerLon = (centerLon + elapsed * .85 + 360) % 360;
    const minFrameMs = smallScreen.matches ? 55 : 36;
    if (now - previousFrame >= minFrameMs) {
      draw();
      previousFrame = now;
    }
    animationId = window.requestAnimationFrame(tick);
  }

  function sync() {
    stop();
    draw();
    if (visible && geographyReady && !reducedMotion.matches && !document.hidden) {
      animationId = window.requestAnimationFrame(tick);
    }
  }

  canvas.addEventListener("pointerdown", e => {
    if (reducedMotion.matches) return;
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if (!dragging) return;
    centerLon -= (e.clientX - dragX) * .25;
    centerLat = Math.max(-75, Math.min(75, centerLat + (e.clientY - dragY) * .17));
    dragX = e.clientX; dragY = e.clientY;
    draw();
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(eventName, () => dragging = false);
  }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => {
    visible = !!entries[0]?.isIntersecting;
    sync();
  }, { rootMargin: "90px" }).observe(holder);
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener?.("change", sync);

  Promise.all([
    fetch("/data/zbt-geography.json", { cache: "force-cache" }).then(response => {
      if (!response.ok) throw new Error("Geography HTTP " + response.status);
      return response.json();
    }),
    new Promise(resolve => {
      mark.onload = () => { markReady = true; resolve(); };
      mark.onerror = () => resolve();
      mark.src = "/assets/zebrabyte-mark.svg";
    })
  ]).then(([data]) => {
    if (!Array.isArray(data.features) || !data.features.length) throw new Error("Invalid globe data");
    countries = data.features.map(feature => ({
      code: feature.c,
      rings: feature.r.map(encoded => decodePolyline(encoded).map(raw => ({ raw, v: geoPoint(raw[0], raw[1]) })))
    }));
    landDots = decodePolyline(data.dots).map(raw => geoPoint(raw[0], raw[1]));
    geographyReady = true;
    holder.dataset.ready = "true";
    resize();
    sync();
  }).catch(error => {
    console.warn("ZebraByte globe unavailable:", error);
    // The static ZebraByte SVG remains visible, with no broken layout.
  });
})();
