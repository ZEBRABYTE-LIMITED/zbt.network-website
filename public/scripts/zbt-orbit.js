(() => {
  "use strict";

  const base = document.getElementById("zbt-orbit-base");
  const landCanvas = document.getElementById("zbt-orbit-land");
  const effectCanvas = document.getElementById("zbt-orbit-effects");
  if (!base || !landCanvas || !effectCanvas) return;
  const baseCtx = base.getContext("2d", {alpha:true});
  const landCtx = landCanvas.getContext("2d", {alpha:true});
  const fxCtx = effectCanvas.getContext("2d", {alpha:true});
  if (!baseCtx || !landCtx || !fxCtx) return;

  const stage = base.parentElement;
  const hero = stage.closest(".tempo-hero");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = matchMedia("(max-width: 760px)");
  const RAD = Math.PI / 180;
  const imgs = [
    "/assets/zebrabyte-glyph-ocean.svg",
    "/assets/zebrabyte-glyph-land.svg",
    "/assets/zebrabyte-glyph-led.svg"
  ].map(src => {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    return image;
  });

  const ocean = [];
  const land = [];
  const stars = [];
  let w = 1, h = 1, dpr = 1;
  let cx = 1, cy = 1, radius = 1, size = 9;
  let ready = false, visible = true, dragging = false;
  let longitude = 0.18, incline = 0.17;
  let lastX = 0, lastY = 0, frame = 0, previous = 0, lastDraw = 0;

  // Equal-area Fibonacci distribution. The ocean layer covers the *entire*
  // visible hemisphere, unlike a continent-only particle mask.
  const oceanCount = 12350;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < oceanCount; i++) {
    const latitude = 1 - ((i + .5) / oceanCount) * 2;
    const ring = Math.sqrt(1 - latitude * latitude);
    const azimuth = i * golden;
    ocean.push([Math.sin(azimuth) * ring, latitude, Math.cos(azimuth) * ring]);
  }

  // Stable star positions; no random flashing each frame.
  for (let i = 0; i < 145; i++) {
    const x = (Math.sin(i * 127.1 + 12.7) * 43758.5453) % 1;
    const y = (Math.sin(i * 311.7 + 43.1) * 20537.8311) % 1;
    stars.push({x:Math.abs(x),y:Math.abs(y),power:((i * 29) % 9)/9});
  }

  // Public-domain Natural Earth land mask encoded with 1/100° precision.
  function decodeLand(encoded) {
    let index = 0, lon = 0, lat = 0;
    while (index < encoded.length) {
      const deltas = [];
      for (let axis = 0; axis < 2; axis++) {
        let value = 0, shift = 0, part = 0;
        do {
          if (index >= encoded.length) throw new Error("Invalid geographic data");
          part = encoded.charCodeAt(index++) - 63;
          value |= (part & 31) << shift;
          shift += 5;
        } while (part >= 32);
        deltas.push(value & 1 ? ~(value >> 1) : value >> 1);
      }
      lon += deltas[0];
      lat += deltas[1];
      const lambda = lon / 100 * RAD;
      const phi = lat / 100 * RAD;
      const c = Math.cos(phi);
      land.push([Math.sin(lambda)*c,Math.sin(phi),Math.cos(lambda)*c]);
    }
  }

  // Project onto the hemisphere facing the viewer, preserving the rounded
  // form of the symbol-built planet without drawing a solid disk.
  function project(p, angle, tilt) {
    const co = Math.cos(angle), si = Math.sin(angle);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const x = p[0]*co - p[2]*si;
    const front = p[2]*co + p[0]*si;
    const y = p[1]*ct - front*st;
    const z = p[1]*st + front*ct;
    return [cx + x*radius,cy - y*radius,z];
  }

  // Fixed ocean screen-space glyphs remain stationary; animated continents
  // will turn over this lattice. Sphere never has a colored background.
  function drawOcean() {
    baseCtx.clearRect(0,0,w,h);
    const sprite = imgs[0];
    for (const p of ocean) {
      const [x,y,z] = project(p,-.10,.14);
      if (z < .025) continue;
      const edge = Math.pow(z,.54);
      const glyphSize = size * (.8 + .2*z);
      baseCtx.globalAlpha = .31 + .50*edge;
      baseCtx.drawImage(sprite,x-glyphSize/2,y-glyphSize/2,glyphSize,glyphSize);
    }
    baseCtx.globalAlpha=1;
  }

  function drawLand(time) {
    landCtx.clearRect(0,0,w,h);
    const sprite = imgs[1], led = imgs[2];
    const symbols = [];
    const spacing = size*.90;
    const spacingSquared = spacing*spacing;
    for (let i=0;i<land.length;i++) {
      const [x,y,z]=project(land[i],longitude,incline);
      if (z <= .04) continue;
      symbols.push({x,y,z,id:i});
    }
    // Front-first for stable non-overlapping marks on the near hemisphere.
    symbols.sort((a,b)=>b.z-a.z);
    const bins=new Map();
    for (const mark of symbols) {
      const col=Math.floor(mark.x/spacing),row=Math.floor(mark.y/spacing);
      let collision=false;
      for (let dx=-1;dx<=1 && !collision;dx++) {
        for (let dy=-1;dy<=1 && !collision;dy++) {
          const others=bins.get((col+dx)+":"+(row+dy));
          if (!others) continue;
          for (const other of others) {
            const dX=other.x-mark.x,dY=other.y-mark.y;
            if (dX*dX+dY*dY < spacingSquared){collision=true;break;}
          }
        }
      }
      if(collision)continue;
      const key=col+":"+row;
      if(!bins.has(key))bins.set(key,[]);
      bins.get(key).push(mark);
      const depth=Math.sqrt(mark.z);
      const s=size*(.86+.14*mark.z);
      landCtx.globalAlpha=.59+.40*depth;
      landCtx.drawImage(sprite,mark.x-s/2,mark.y-s/2,s,s);
      if(mark.id % 32 === 0) {
        const wave = .5 + .5*Math.sin(time*.0012+mark.id*1.618);
        const pulse=Math.pow(wave,11);
        if(pulse>.12) {
          const bright=s*(1+pulse*.10);
          landCtx.globalAlpha=pulse*.46;
          landCtx.drawImage(led,mark.x-bright/2,mark.y-bright/2,bright,bright);
        }
      }
    }
    landCtx.globalAlpha=1;
  }

  function drawEffects(time) {
    fxCtx.clearRect(0,0,w,h);
    // Sparse dust is a subtle monochrome counterpart of Tempo's starfield.
    for(const star of stars) {
      const alpha=.08 + star.power*.12;
      fxCtx.globalAlpha=alpha;
      fxCtx.fillStyle="#2b2b2b";
      fxCtx.beginPath();
      fxCtx.arc(star.x*w,star.y*h,star.power>.75?1.3:.75,0,2*Math.PI);
      fxCtx.fill();
    }
    fxCtx.globalAlpha=1;
    if(reducedMotion.matches)return;
    // Two original elliptical ribbons, almost invisible except for a spark.
    for(let i=0;i<2;i++) {
      const span=i===0?1.03:.83;
      const angle=i===0?-.22:.33;
      const travel=time*.00018+i*.39;
      const x0=cx-radius*span, x1=cx+radius*span;
      const y0=cy+radius*angle, y1=cy-radius*angle;
      fxCtx.beginPath();
      fxCtx.moveTo(x0,y0);
      fxCtx.bezierCurveTo(cx-radius*.43,cy-radius*(.2+i*.3),cx+radius*.40,cy+radius*(.22-i*.3),x1,y1);
      fxCtx.strokeStyle=i===0?"rgba(30,30,30,.09)":"rgba(70,70,70,.06)";
      fxCtx.lineWidth=1;
      fxCtx.stroke();
      const t=((travel%1)+1)%1;
      const s=1-t;
      const px=s*s*s*x0+3*s*s*t*(cx-radius*.43)+3*s*t*t*(cx+radius*.40)+t*t*t*x1;
      const py=s*s*s*y0+3*s*s*t*(cy-radius*(.2+i*.3))+3*s*t*t*(cy+radius*(.22-i*.3))+t*t*t*y1;
      fxCtx.beginPath();
      fxCtx.fillStyle="#272727";
      fxCtx.globalAlpha=.30;
      fxCtx.shadowColor="#555";
      fxCtx.shadowBlur=8;
      fxCtx.arc(px,py,i===0?2.3:1.7,0,2*Math.PI);
      fxCtx.fill();
      fxCtx.shadowBlur=0;
      fxCtx.globalAlpha=1;
    }
  }

  function measure() {
    const rect=stage.getBoundingClientRect();
    const nextW=Math.max(1,rect.width),nextH=Math.max(1,rect.height);
    if (Math.abs(nextW-w)<.3 && Math.abs(nextH-h)<.3 && base.width>1)return;
    w=nextW;h=nextH;
    const isMobile=mobile.matches;
    dpr=Math.min(devicePixelRatio||1,isMobile?1.5:2);
    cx=w*(isMobile?.18:.22);
    cy=h*(isMobile?.49:.53);
    radius=isMobile?Math.min(w*.99,h*.57):Math.min(w*.44,h*.69);
    size=Math.min(15.5,Math.max(8.1,radius*.022));
    for (const c of [base,landCanvas,effectCanvas]){
      c.width=Math.round(w*dpr);
      c.height=Math.round(h*dpr);
    }
    for(const context of [baseCtx,landCtx,fxCtx])
      context.setTransform(dpr,0,0,dpr,0,0);
    if(ready){
      drawOcean();
      drawLand(0);
      drawEffects(0);
    }
  }

  function stop() {
    if(frame)cancelAnimationFrame(frame);
    frame=0;previous=0;lastDraw=0;
  }

  function animate(now) {
    frame=0;
    if(!visible||document.hidden||reducedMotion.matches)return;
    const dt=previous?Math.min(.07,(now-previous)/1000):0;
    previous=now;
    if(!dragging)longitude+=dt*.082;
    if(now-lastDraw>=(mobile.matches?47:33)) {
      drawLand(now);
      drawEffects(now);
      lastDraw=now;
    }
    frame=requestAnimationFrame(animate);
  }

  function sync() {
    stop();
    if(!ready)return;
    drawLand(0);
    drawEffects(0);
    if(visible&&!document.hidden&&!reducedMotion.matches)
      frame=requestAnimationFrame(animate);
  }

  base.addEventListener("pointerdown",e=>{
    if(reducedMotion.matches)return;
    dragging=true;lastX=e.clientX;lastY=e.clientY;
    base.setPointerCapture(e.pointerId);
  });
  base.addEventListener("pointermove",e=>{
    if(!dragging)return;
    longitude-=(e.clientX-lastX)*.0037;
    incline=Math.max(-.8,Math.min(.8,incline+(e.clientY-lastY)*.0022));
    lastX=e.clientX;lastY=e.clientY;
    drawLand(performance.now());
  });
  for(const type of ["pointerup","pointercancel","lostpointercapture"])
    base.addEventListener(type,()=>{dragging=false;});

  new ResizeObserver(measure).observe(stage);
  new IntersectionObserver(entries=>{
    visible=!!entries[0]?.isIntersecting;
    sync();
  },{rootMargin:"120px"}).observe(hero);
  document.addEventListener("visibilitychange",sync);
  reducedMotion.addEventListener?.("change",sync);

  Promise.all([
    fetch("/data/zbt-continent-dots.json",{cache:"force-cache"}).then(response=>{
      if(!response.ok)throw new Error("Unable to load land mask");
      return response.json();
    }),
    Promise.all(imgs.map(image=>new Promise(resolve=>{
      if(image.complete&&image.naturalWidth){resolve(true);return;}
      image.onload=()=>resolve(true);
      image.onerror=()=>resolve(false);
    })))
  ]).then(([data,success])=>{
    if(!success.every(Boolean))throw new Error("ZebraByte emblem assets unavailable");
    if(typeof data.polyline!=="string"||data.points<1000)
      throw new Error("Invalid continent geometry");
    decodeLand(data.polyline);
    if(land.length!==data.points)throw new Error("Incomplete continent mask");
    ready=true;
    stage.dataset.ready="true";
    measure();
    drawOcean();
    sync();
  }).catch(error=>console.warn("ZebraByte globe:",error));
})();
