(() => {
  "use strict";

  const canvas = document.getElementById("zbt-globe-base");
  const inkCanvas = document.getElementById("zbt-globe-ink");
  if (!canvas || !inkCanvas) return;
  const baseCtx = canvas.getContext("2d", {alpha:true});
  const inkCtx = inkCanvas.getContext("2d", {alpha:true});
  if (!baseCtx || !inkCtx) return;
  const holder = canvas.parentElement;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = matchMedia("(max-width: 760px)");
  const oceanGlyph = new Image();
  const landGlyph = new Image();
  const maskImage = new Image();
  for (const img of [oceanGlyph,landGlyph,maskImage]) img.decoding = "async";

  const DEG = 180 / Math.PI;
  const maskWidth = 1024, maskHeight = 512;
  let maskBytes;
  let dots = [];
  let width = 1, height = 1, ratio = 1, radius = 1;
  let longitude = .20, incline = .25, lastTime = 0;
  let ready = false, visible = true, dragging = false, mouseX = 0, mouseY = 0;
  let raf = 0, lastPaint = 0;

  function makeDots() {
    dots = [];
    const cx = width / 2, cy = height / 2;
    radius = Math.min(width, height) * .473;
    const spacing = mobile.matches ? Math.max(8.3, width*.029) : Math.max(9.1, width*.0185);
    const stepY = spacing * Math.sqrt(3) / 2;
    const symbol = spacing * .77;
    let row = 0;
    for (let y = -radius; y <= radius; y += stepY, row++) {
      const offset = row % 2 ? spacing/2 : 0;
      for (let x = -radius + offset; x < radius; x += spacing) {
        const u=x/radius, v=-y/radius;
        const rr=u*u+v*v;
        if (rr >= .992) continue;
        const z=Math.sqrt(1-rr);
        dots.push({
          x:cx+x, y:cy+y, u,v,z,
          size:symbol,
          fade: .46 + .48*Math.pow(z,.32),
          dark:0,
          phase:(row*29 + Math.round(x*5))*0.1569
        });
      }
    }
  }

  // The neutral grey ZebraByte symbols are drawn ONCE and never move.
  function drawBase() {
    baseCtx.clearRect(0,0,width,height);
    for (const dot of dots) {
      baseCtx.globalAlpha=dot.fade;
      baseCtx.drawImage(oceanGlyph,dot.x-dot.size/2,dot.y-dot.size/2,dot.size,dot.size);
    }
    baseCtx.globalAlpha=1;
  }

  function isLand(u,v,z,cosLon,sinLon,cosLat,sinLat) {
    // Inverse camera transform: which geographical coordinate sits
    // beneath this single fixed screen-space ZebraByte emblem?
    const latitudeY=v*cosLat + z*sinLat;
    const forward=z*cosLat - v*sinLat;
    const wx=u*cosLon + forward*sinLon;
    const wz=forward*cosLon - u*sinLon;
    const lat=Math.asin(Math.max(-1,Math.min(1,latitudeY)))*DEG;
    const lon=Math.atan2(wx,wz)*DEG;
    let ix=Math.floor((lon+180)/360*maskWidth);
    let iy=Math.floor((90-lat)/180*maskHeight);
    ix=((ix%maskWidth)+maskWidth)%maskWidth;
    iy=Math.max(0,Math.min(maskHeight-1,iy));
    return maskBytes[iy*maskWidth+ix] > 127;
  }

  // Exactly aligned overlays: an emblem simply changes from grey to black.
  // There are NEVER two displaced sets of emblems or duplicate silhouettes.
  function drawContinents(dt,now) {
    inkCtx.clearRect(0,0,width,height);
    const cs=Math.cos(longitude),sn=Math.sin(longitude);
    const ct=Math.cos(incline),st=Math.sin(incline);
    const ease=dt>0 ? (1-Math.exp(-dt*8.5)) : 1;
    for (const dot of dots) {
      const target=isLand(dot.u,dot.v,dot.z,cs,sn,ct,st)?1:0;
      dot.dark += (target-dot.dark)*ease;
      if (dot.dark < .013) continue;
      // A gentle "LED" breathe changes the tone of selected black emblems;
      // it does not draw more emblems on top of the fixed grid.
      const led = (!reducedMotion.matches && Math.round(dot.x*7+dot.y*3)%37===0)
        ? .94+.06*Math.sin(now*.002+dot.phase)
        : 1;
      inkCtx.globalAlpha=dot.fade*dot.dark*led;
      inkCtx.drawImage(landGlyph,dot.x-dot.size/2,dot.y-dot.size/2,dot.size,dot.size);
    }
    inkCtx.globalAlpha=1;
  }

  function measure() {
    const rect=holder.getBoundingClientRect();
    const nextW=Math.max(1,rect.width),nextH=Math.max(1,rect.height);
    if (canvas.width>1 && Math.abs(nextW-width)<.3 && Math.abs(nextH-height)<.3) return;
    width=nextW;
    height=nextH;
    ratio=Math.min(devicePixelRatio||1,mobile.matches?2.4:2);
    for (const c of [canvas,inkCanvas]) {
      c.width=Math.round(width*ratio);
      c.height=Math.round(height*ratio);
    }
    baseCtx.setTransform(ratio,0,0,ratio,0,0);
    inkCtx.setTransform(ratio,0,0,ratio,0,0);
    makeDots();
    if (ready) {
      drawBase();
      drawContinents(0,reducedMotion.matches?0:performance.now());
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf=0;lastTime=0;lastPaint=0;
  }

  function tick(now) {
    raf=0;
    if (!ready || !visible || document.hidden || reducedMotion.matches) return;
    const dt=lastTime?Math.min(.08,(now-lastTime)/1000):0;
    lastTime=now;
    if(!dragging) longitude+=dt*.075;
    const cadence=mobile.matches?55:35;
    if(now-lastPaint>=cadence) {
      drawContinents(Math.min(.10,(now-lastPaint)/1000 || dt),now);
      lastPaint=now;
    }
    raf=requestAnimationFrame(tick);
  }

  function sync() {
    stop();
    if(!ready) return;
    drawContinents(0,reducedMotion.matches?0:performance.now());
    if(visible && !document.hidden && !reducedMotion.matches) raf=requestAnimationFrame(tick);
  }

  canvas.addEventListener("pointerdown",event=>{
    if (reducedMotion.matches) return;
    dragging=true;mouseX=event.clientX;mouseY=event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove",event=>{
    if(!dragging) return;
    longitude-=(event.clientX-mouseX)*.0042;
    incline=Math.max(-.8,Math.min(.8,incline+(event.clientY-mouseY)*.0023));
    mouseX=event.clientX;mouseY=event.clientY;
    drawContinents(.05,performance.now());
  });
  for(const type of ["pointerup","pointercancel","lostpointercapture"]) {
    canvas.addEventListener(type,()=>{dragging=false;});
  }

  new ResizeObserver(measure).observe(holder);
  new IntersectionObserver(entries=>{
    visible=Boolean(entries[0]?.isIntersecting);
    sync();
  },{rootMargin:"90px"}).observe(holder);
  document.addEventListener("visibilitychange",sync);
  reducedMotion.addEventListener?.("change",sync);

  Promise.all([
    [oceanGlyph,landGlyph,maskImage].map((image,index)=>new Promise(resolve=>{
      image.onload=()=>resolve(true);
      image.onerror=()=>resolve(false);
      image.src=[
        "/assets/zebrabyte-glyph-ocean.svg",
        "/assets/zebrabyte-glyph-land.svg",
        "/assets/zbt-earth-mask.png"
      ][index];
    }))
  ].flat()).then(results=>{
    if(!results.every(Boolean))throw new Error("Globe assets failed to load");
    const maskCanvas=document.createElement("canvas");
    maskCanvas.width=maskWidth;maskCanvas.height=maskHeight;
    const maskCtx=maskCanvas.getContext("2d",{willReadFrequently:true});
    maskCtx.drawImage(maskImage,0,0,maskWidth,maskHeight);
    const pixels=maskCtx.getImageData(0,0,maskWidth,maskHeight).data;
    maskBytes=new Uint8Array(maskWidth*maskHeight);
    for(let i=0;i<maskBytes.length;i++)maskBytes[i]=pixels[i*4];
    ready=true;
    holder.dataset.ready="true";
    measure();
    drawBase();
    sync();
  }).catch(error=>console.warn("ZebraByte globe failed:",error));
})();
