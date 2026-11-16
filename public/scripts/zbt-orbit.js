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
    const spacing = mobile.matches
      ? Math.max(5.4, Math.min(6.5, width * .0175))
      : Math.max(6.3, Math.min(8.0, width * .0093));
    const stepY = spacing * Math.sqrt(3) / 2;
    const symbol = spacing * .72;
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
          size:symbol * (.68 + .32*Math.pow(z,.43)),
          fade: .32 + .66*Math.pow(z,.48),
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

  function landCoverage(u,v,z,cosLon,sinLon,cosLat,sinLat) {
    // Inverse camera transform: which geographical coordinate sits
    // beneath this single fixed screen-space ZebraByte emblem?
    const latitudeY=v*cosLat + z*sinLat;
    const forward=z*cosLat - v*sinLat;
    const wx=u*cosLon + forward*sinLon;
    const wz=forward*cosLon - u*sinLon;
    const lat=Math.asin(Math.max(-1,Math.min(1,latitudeY)))*DEG;
    const lon=Math.atan2(wx,wz)*DEG;
    // Bilinear land sampling and a slightly blurred source mask turn
    // stair-stepped coarse coastlines into graceful gradients.
    const mx=(lon+180)/360*maskWidth - .5;
    const my=(90-lat)/180*maskHeight - .5;
    const x0=Math.floor(mx),y0=Math.floor(my);
    const tx=mx-x0,ty=my-y0;
    const xA=((x0%maskWidth)+maskWidth)%maskWidth;
    const xB=(xA+1)%maskWidth;
    const yA=Math.max(0,Math.min(maskHeight-1,y0));
    const yB=Math.max(0,Math.min(maskHeight-1,y0+1));
    const a=maskBytes[yA*maskWidth+xA],b=maskBytes[yA*maskWidth+xB];
    const c=maskBytes[yB*maskWidth+xA],d=maskBytes[yB*maskWidth+xB];
    return ((a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty)/255;
  }


  // GPU fast path: the black mask is sampled per fixed ZebraByte glyph in
  // a single instanced draw call. No repeated SVG drawImage calls per frame.
  let gpu = null;
  function initGPU(maskCanvas) {
    const extra = document.createElement("canvas");
    extra.className = "intro-globe-canvas intro-globe-ink";
    extra.style.zIndex = "3";
    extra.style.pointerEvents = "none";
    const gl = extra.getContext("webgl2", {
      alpha:true, antialias:true, premultipliedAlpha:false,
      powerPreference:"low-power"
    });
    if (!gl) return;

    const vsText = [
      "#version 300 es",
      "precision highp float;",
      "layout(location=0) in vec2 corner;",
      "layout(location=1) in vec2 xy;",
      "layout(location=2) in vec3 dir;",
      "layout(location=3) in vec2 szfade;",
      "uniform vec2 viewport;",
      "uniform vec4 orientation;",
      "uniform float elapsed;",
      "uniform sampler2D earth;",
      "out vec2 uv;",
      "out float opacity;",
      "void main() {",
      "const float PI=3.14159265358979;",
      "float v=dir.y; float z=dir.z; float u=dir.x;",
      "float n=clamp(v*orientation.z+z*orientation.w,-1.0,1.0);",
      "float f=z*orientation.z-v*orientation.w;",
      "float wx=u*orientation.x+f*orientation.y;",
      "float wz=f*orientation.x-u*orientation.y;",
      "vec2 mapUV=vec2(fract((atan(wx,wz)+PI)/(2.0*PI)),(PI*.5-asin(n))/PI);",
      "float land=texture(earth,mapUV).r;",
      "float seed=fract(sin(float(gl_InstanceID)*12.9898)*43758.5453);",
      "float pulse=pow(.5+.5*sin(elapsed*1.8+seed*25.0),8.0);",
      "float led=step(.974,seed)*pulse*.08;",
      "opacity=clamp(land*(1.0+led),0.0,1.0)*szfade.y;",
      "uv=corner+vec2(.5);",
      "vec2 p=xy+corner*szfade.x;",
      "gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,0.0,1.0);",
      "}"
    ].join("\n");
    const fsText = [
      "#version 300 es",
      "precision mediump float;",
      "uniform sampler2D emblem;",
      "in vec2 uv;",
      "in float opacity;",
      "out vec4 color;",
      "void main(){",
      "float a=texture(emblem,uv).a;",
      "color=vec4(.078,.078,.078,a*opacity);",
      "}"
    ].join("\n");
    function shader(type,code){
      const sh=gl.createShader(type);
      gl.shaderSource(sh,code);
      gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))
        throw new Error("GPU shader "+gl.getShaderInfoLog(sh));
      return sh;
    }
    try {
      const vertex=shader(gl.VERTEX_SHADER,vsText);
      const frag=shader(gl.FRAGMENT_SHADER,fsText);
      const program=gl.createProgram();
      gl.attachShader(program,vertex);
      gl.attachShader(program,frag);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(frag);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))
        throw new Error("GPU link "+gl.getProgramInfoLog(program));
      const vao=gl.createVertexArray();
      gl.bindVertexArray(vao);
      const quad=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,quad);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
        -.5,-.5,.5,-.5,-.5,.5,.5,.5
      ]),gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      const instances=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,instances);
      for(const [location,length,offset] of [[1,2,0],[2,3,8],[3,2,20]]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location,length,gl.FLOAT,false,28,offset);
        gl.vertexAttribDivisor(location,1);
      }
      gl.bindVertexArray(null);
      function texture(source,unit,repeat) {
        const tex=gl.createTexture();
        gl.activeTexture(gl.TEXTURE0+unit);
        gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
        for(const [key,value] of [
          [gl.TEXTURE_MIN_FILTER,gl.LINEAR],
          [gl.TEXTURE_MAG_FILTER,gl.LINEAR],
          [gl.TEXTURE_WRAP_S,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]
        ]) gl.texParameteri(gl.TEXTURE_2D,key,value);
        return tex;
      }
      const earthTexture=texture(maskCanvas,0,true);
      const glyphTexture=texture(landGlyph,1,false);
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program,"earth"),0);
      gl.uniform1i(gl.getUniformLocation(program,"emblem"),1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gpu={
        gl,canvas:extra,program,vao,instances,earthTexture,glyphTexture,
        viewport:gl.getUniformLocation(program,"viewport"),
        orientation:gl.getUniformLocation(program,"orientation"),
        elapsed:gl.getUniformLocation(program,"elapsed")
      };
      holder.appendChild(extra);
      inkCanvas.style.display="none";
      holder.dataset.renderer="webgl2";
    } catch(error) {
      console.warn("ZebraByte WebGL unavailable, retaining Canvas fallback",error);
      gpu=null;
      extra.remove();
    }
  }

  function uploadGPU() {
    if(!gpu)return;
    const buffer=new Float32Array(dots.length*7);
    for(let i=0;i<dots.length;i++){
      const d=dots[i],at=i*7;
      buffer[at]=d.x;buffer[at+1]=d.y;
      buffer[at+2]=d.u;buffer[at+3]=d.v;buffer[at+4]=d.z;
      buffer[at+5]=d.size;buffer[at+6]=d.fade;
    }
    const {gl,instances}=gpu;
    gl.bindBuffer(gl.ARRAY_BUFFER,instances);
    gl.bufferData(gl.ARRAY_BUFFER,buffer,gl.STATIC_DRAW);
  }

  function drawGPU(now) {
    const {gl,canvas,program,vao,earthTexture,glyphTexture}=gpu;
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(gpu.viewport,width,height);
    gl.uniform4f(gpu.orientation,
      Math.cos(longitude),Math.sin(longitude),Math.cos(incline),Math.sin(incline));
    gl.uniform1f(gpu.elapsed,reducedMotion.matches?0:now/1000);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,earthTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D,glyphTexture);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,dots.length);
    gl.bindVertexArray(null);
  }

  // Exactly aligned overlays: an emblem simply changes from grey to black.
  // There are NEVER two displaced sets of emblems or duplicate silhouettes.
  function drawContinents(dt,now) {
    if (gpu) { drawGPU(now); return; }
    inkCtx.clearRect(0,0,width,height);
    const cs=Math.cos(longitude),sn=Math.sin(longitude);
    const ct=Math.cos(incline),st=Math.sin(incline);
    const ease=dt>0 ? (1-Math.exp(-dt*8.5)) : 1;
    for (const dot of dots) {
      const target=landCoverage(dot.u,dot.v,dot.z,cs,sn,ct,st);
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
    ratio=Math.min(devicePixelRatio||1,mobile.matches?2.5:2);
    for (const c of [canvas,inkCanvas]) {
      c.width=Math.round(width*ratio);
      c.height=Math.round(height*ratio);
    }
    if(gpu) {
      gpu.canvas.width=Math.round(width*ratio);
      gpu.canvas.height=Math.round(height*ratio);
    }
    baseCtx.setTransform(ratio,0,0,ratio,0,0);
    inkCtx.setTransform(ratio,0,0,ratio,0,0);
    makeDots();
    holder.dataset.symbols=String(dots.length);
    uploadGPU();
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
    const cadence=gpu?(mobile.matches?42:33):(mobile.matches?100:70);
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
    // One-time anti-aliasing of the source land mask. No per-frame blur.
    maskCtx.filter="blur(1.45px)";
    maskCtx.drawImage(maskImage,0,0,maskWidth,maskHeight);
    maskCtx.filter="none";
    const pixels=maskCtx.getImageData(0,0,maskWidth,maskHeight).data;
    maskBytes=new Uint8Array(maskWidth*maskHeight);
    for(let i=0;i<maskBytes.length;i++)maskBytes[i]=pixels[i*4];
    initGPU(maskCanvas);
    ready=true;
    holder.dataset.ready="true";
    measure();
    drawBase();
    sync();
  }).catch(error=>console.warn("ZebraByte globe failed:",error));
})();
