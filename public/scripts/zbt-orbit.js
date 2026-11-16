(() => {
  "use strict";

  const canvas = document.getElementById("zbt-globe");
  const ctx = canvas?.getContext?.("2d", { alpha: true });
  if (!canvas || !ctx) return;

  const holder = canvas.parentElement;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const smallScreen = matchMedia("(max-width: 760px)");
  const RAD = Math.PI / 180;
  const glyph = new Image();
  const ledGlyph = new Image();
  glyph.decoding = "async";
  ledGlyph.decoding = "async";

  // This cached layer never rotates. Its faint monograms suggest depth while
  // a separate, brighter layer rotates in front of it.
  const staticCanvas = document.createElement("canvas");
  const staticCtx = staticCanvas.getContext("2d", { alpha: true });
  if (!staticCtx) return;

  const rawLand = [];
  let movingDesktop = [], movingMobile = [];
  let staticDesktop = [], staticMobile = [];
  let staticLights = [];
  let width = 1, height = 1, dpr = 1;
  let ready = false, rotation = 8 * RAD, tilt = 14 * RAD;
  let frame = 0, lastTime = 0, lastPaint = 0;
  let visible = true, dragging = false, pointerX = 0, pointerY = 0;

  function decodeLand(encoded) {
    let index = 0, longitude = 0, latitude = 0;
    while (index < encoded.length) {
      const values = [];
      for (let channel = 0; channel < 2; channel++) {
        let value = 0, shift = 0, part;
        do {
          if (index >= encoded.length) throw new Error("Incomplete ZebraByte globe geometry");
          part = encoded.charCodeAt(index++) - 63;
          value |= (part & 31) << shift;
          shift += 5;
        } while (part >= 32);
        values.push((value & 1) ? ~(value >> 1) : value >> 1);
      }
      longitude += values[0];
      latitude += values[1];
      const lambda = longitude / 100 * RAD;
      const phi = latitude / 100 * RAD;
      const cosPhi = Math.cos(phi);
      rawLand.push([cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)]);
    }
  }

  // Controlled spacing on the sphere prevents clumps of tiny overlapping logos.
  function distributeLand(minDegrees) {
    const chord = 2 * Math.sin((minDegrees * RAD) / 2);
    const limit = chord * chord;
    const buckets = new Map();
    const chosen = [];
    const order = rawLand.map((_, i) => i);
    order.sort((a, b) =>
      (Math.imul(a + 1, 2654435761) >>> 0) -
      (Math.imul(b + 1, 2654435761) >>> 0)
    );

    for (const index of order) {
      const point = rawLand[index];
      const x = Math.floor((point[0] + 1) / chord);
      const y = Math.floor((point[1] + 1) / chord);
      const z = Math.floor((point[2] + 1) / chord);
      let overlap = false;
      for (let dx = -1; dx <= 1 && !overlap; dx++) {
        for (let dy = -1; dy <= 1 && !overlap; dy++) {
          for (let dz = -1; dz <= 1 && !overlap; dz++) {
            const neighbours = buckets.get((x+dx) + ":" + (y+dy) + ":" + (z+dz));
            if (!neighbours) continue;
            for (const near of neighbours) {
              const a = point[0]-near[0], b = point[1]-near[1], c = point[2]-near[2];
              if (a*a + b*b + c*c < limit) { overlap = true; break; }
            }
          }
        }
      }
      if (overlap) continue;
      chosen.push(point);
      const key = x + ":" + y + ":" + z;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(point);
    }
    return chosen;
  }

  function project(point, angle, incline, centreX, centreY, radius) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const ct = Math.cos(incline), st = Math.sin(incline);
    const x = point[0] * cs - point[2] * sn;
    const forward = point[2] * cs + point[0] * sn;
    const y = point[1] * ct - forward * st;
    const depth = point[1] * st + forward * ct;
    return {
      x: centreX + x * radius,
      y: centreY - y * radius,
      depth
    };
  }

  // The screen-space filter runs after projection: a mark on the far side
  // cannot visually collide with or obscure a mark on the near side.
  function visibleMarks(points, angle, incline, spacing) {
    const cx = width / 2, cy = height / 2;
    const radius = Math.min(width, height) * .46;
    const projected = [];
    for (let i=0; i<points.length; i++) {
      const item = project(points[i], angle, incline, cx, cy, radius);
      if (item.depth > .055) projected.push({ ...item, id:i });
    }
    projected.sort((a, b) => b.depth - a.depth);
    const bins = new Map();
    const filtered = [];
    const distance = spacing * spacing;
    for (const item of projected) {
      const gx = Math.floor(item.x / spacing), gy = Math.floor(item.y / spacing);
      let collides = false;
      for (let x=-1; x<=1 && !collides; x++) {
        for (let y=-1; y<=1 && !collides; y++) {
          const adjacent = bins.get((gx+x)+":"+(gy+y));
          if (!adjacent) continue;
          for (const other of adjacent) {
            const dx=item.x-other.x, dy=item.y-other.y;
            if (dx*dx + dy*dy < distance) { collides=true; break; }
          }
        }
      }
      if (collides) continue;
      const key=gx+":"+gy;
      if(!bins.has(key)) bins.set(key,[]);
      bins.get(key).push(item);
      filtered.push(item);
    }
    return filtered;
  }

  function dimensions() {
    const radius = Math.min(width, height) * .46;
    const mobile = smallScreen.matches;
    const frontSize = mobile
      ? Math.max(8.4, Math.min(10.5, radius * .062))
      : Math.max(12, Math.min(15, radius * .048));
    return {
      frontSize,
      backSize: frontSize * .83,
      mobile
    };
  }

  function paintStaticLayer() {
    if (!ready) return;
    staticCanvas.width = canvas.width;
    staticCanvas.height = canvas.height;
    staticCtx.setTransform(dpr,0,0,dpr,0,0);
    staticCtx.clearRect(0,0,width,height);
    staticLights = [];

    const sizes = dimensions();
    const points = sizes.mobile ? staticMobile : staticDesktop;
    // A small perspective difference makes the ghost layer visible even
    // when the front globe is close to its original orientation.
    const background = visibleMarks(points, -13 * RAD, 13 * RAD, sizes.backSize * .92);
    for (const mark of background) {
      const size = sizes.backSize * (.85 + .14 * mark.depth);
      staticCtx.globalAlpha = .09 + .15 * Math.sqrt(mark.depth);
      staticCtx.drawImage(glyph, mark.x - size / 2, mark.y - size / 2, size, size);
      // These positions do not move. Selected ones glow gently like LEDs.
      if (mark.id % 13 === 0) {
        staticLights.push({ ...mark, size, phase: mark.id * 2.399 });
      }
    }
    staticCtx.globalAlpha=1;
  }

  function pulse(time, phase) {
    const wave = .5 + .5 * Math.sin(time * .00155 + phase);
    return Math.pow(wave, 9);
  }

  function paintLEDs(context, lights, time, moving) {
    for (const mark of lights) {
      const strength = pulse(time, mark.phase);
      if (strength < .14) continue;
      context.save();
      context.globalAlpha = strength * (moving ? .86 : .43);
      context.shadowColor = "#b99cff";
      context.shadowBlur = moving ? 10 : 7;
      const size=mark.size * (1 + strength * .13);
      context.drawImage(
        ledGlyph,mark.x-size/2,mark.y-size/2,size,size
      );
      context.restore();
    }
  }

  function render(now=0) {
    if (!ready) return;
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(staticCanvas,0,0,width,height);

    const stationaryTime = reducedMotion.matches ? 0 : now;
    paintLEDs(ctx, staticLights, stationaryTime, false);

    const sizes=dimensions();
    const front=visibleMarks(
      sizes.mobile ? movingMobile : movingDesktop,
      rotation,tilt,sizes.frontSize*.84
    );
    const movingLights=[];
    for(const mark of front) {
      const depthGlow=Math.pow(mark.depth,.58);
      const size=sizes.frontSize*(.89+.11*mark.depth);
      ctx.globalAlpha=.39+.43*depthGlow;
      ctx.drawImage(glyph,mark.x-size/2,mark.y-size/2,size,size);
      if(mark.id%15===0) {
        movingLights.push({...mark,size,phase:mark.id*1.721});
      }
    }
    ctx.globalAlpha=1;
    paintLEDs(ctx,movingLights,stationaryTime,true);
  }

  function resize() {
    const rect=canvas.getBoundingClientRect();
    const nextW=Math.max(1,rect.width);
    const nextH=Math.max(1,rect.height);
    if(canvas.width && Math.abs(nextW-width)<.3 && Math.abs(nextH-height)<.3)return;
    width=nextW;
    height=nextH;
    dpr=Math.min(window.devicePixelRatio||1, smallScreen.matches?2.5:2);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    paintStaticLayer();
    render(reducedMotion.matches?0:performance.now());
  }

  function stop() {
    if(frame)cancelAnimationFrame(frame);
    frame=0;
    lastTime=0;
    lastPaint=0;
  }

  function animate(now) {
    frame=0;
    if(!visible || reducedMotion.matches || document.hidden)return;
    const seconds=lastTime?Math.min(.08,(now-lastTime)/1000):0;
    lastTime=now;
    if(!dragging)rotation+=seconds*.105;
    const every=smallScreen.matches?65:38;
    if(now-lastPaint>=every) {
      render(now);
      lastPaint=now;
    }
    frame=requestAnimationFrame(animate);
  }

  function sync() {
    stop();
    render(reducedMotion.matches?0:performance.now());
    if(ready && visible && !reducedMotion.matches && !document.hidden)
      frame=requestAnimationFrame(animate);
  }

  canvas.addEventListener("pointerdown", e => {
    if(smallScreen.matches || reducedMotion.matches)return;
    dragging=true;pointerX=e.clientX;pointerY=e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if(!dragging)return;
    rotation-=(e.clientX-pointerX)*.003;
    tilt=Math.max(-.85,Math.min(.85,tilt+(e.clientY-pointerY)*.002));
    pointerX=e.clientX;pointerY=e.clientY;
    render(performance.now());
  });
  for(const event of ["pointerup","pointercancel","lostpointercapture"])
    canvas.addEventListener(event,()=>{dragging=false;});

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries=>{
    visible=Boolean(entries[0]?.isIntersecting);
    sync();
  },{rootMargin:"100px"}).observe(holder);
  document.addEventListener("visibilitychange",sync);
  reducedMotion.addEventListener?.("change",sync);

  Promise.all([
    fetch("/data/zbt-continent-dots.json",{cache:"force-cache"}).then(res=>{
      if(!res.ok)throw new Error("Globe geography "+res.status);
      return res.json();
    }),
    Promise.all([glyph,ledGlyph].map((image,i)=>new Promise(resolve=>{
      image.onload=()=>resolve(true);
      image.onerror=()=>resolve(false);
      image.src=i?"/assets/zebrabyte-glyph-led.svg":"/assets/zebrabyte-glyph.svg";
    })))
  ]).then(([data,images])=>{
    if(!images.every(Boolean))throw new Error("Globe emblem unavailable");
    if(typeof data.polyline!=="string"||data.points<1000)
      throw new Error("Invalid globe geometry");
    decodeLand(data.polyline);
    if(rawLand.length!==data.points)throw new Error("Incomplete globe geometry");
    movingDesktop=distributeLand(3.1);
    movingMobile=distributeLand(4.1);
    staticDesktop=distributeLand(2.5);
    staticMobile=distributeLand(3.7);
    rawLand.length=0;
    ready=true;
    holder.dataset.ready="true";
    resize();
    sync();
  }).catch(error=>{
    console.warn("ZebraByte globe unavailable:",error);
  });
})();
