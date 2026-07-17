module.exports = {
  name: "Sharingan vigilante — ojo izquierdo",
  init(ctx, api){
    this.px = 0; this.py = 0;
    this.blink = 1; this.nextBlink = 2000; this.blinkStart = null;
    this.focus = 0; this.hold = 0;
    this.variant = 0;          // patrón Mangekyou activo
    this.prevKey = null;       // para detectar hover sobre un nodo nuevo
    this.veins = null;         // venas de esfuerzo (se regeneran por hover)
  },
  frame(ctx, api, t){
    var w = api.width, h = api.height; ctx.clearRect(0,0,w,h);

    // +33% respecto al original, +15% de tamaño distribuido hacia arriba
    var R = Math.min(w,h)*0.28*0.3*1.331*1.15;
    var RX = R*1.6/1.15;                 // ancho sin cambios respecto al original
    var RY = R*0.85;                     // altura +15%
    var cy0 = (R/1.15)*0.85*2.783;       // línea de párpado inferior original
    var cx = RX*1.581*1.15;              // misma X que antes
    var cy = cy0;                        // ancla abajo: todo el crecimiento sube

    var node = api.hoveredNode;

    // variante de Mangekyou ALEATORIA en cada nodo nuevo
    var key = node ? (node.id != null ? node.id : node.x + "," + node.y) : null;
    if (key && key !== this.prevKey){
      this.variant = Math.floor(Math.random()*5);
      this.veins = null;
    }
    this.prevKey = key;

    var tx = node ? node.x : cx + Math.cos(t/1400)*R*1.6;
    var ty = node ? node.y : cy + Math.sin(t/1400)*R*1.6;
    var dx = tx-cx, dy = ty-cy, d = Math.hypot(dx,dy)||1;
    var mx = Math.max(-R*0.35, Math.min(R*0.35, d)), f = mx/d;
    this.px += (dx*f - this.px)*0.15; this.py += (dy*f - this.py)*0.15;

    this.focus += ((node ? 1 : 0) - this.focus)*0.12;
    this.hold  += ((node ? 1 : 0) - this.hold)*0.05;
    var fo = this.focus, mk = node ? Math.min(1, this.hold*1.4) : Math.max(0, this.hold*1.4);

    if (t > this.nextBlink){ this.nextBlink = t + 2500 + Math.random()*2500; this.blinkStart = t; }
    var bp = this.blinkStart != null ? (t - this.blinkStart)/220 : 2;
    this.blink = bp < 1 ? Math.abs(Math.cos(bp*Math.PI)) : 1;

    // CONCENTRACIÓN: entrecierra un poco al despertar el Mangekyou
    var open = this.blink * (1 - 0.10*mk);
    var upH  = RY*(0.95 + 0.35*fo)*open;
    var loH  = RY*(0.80 + 0.15*fo)*open;
    var tilt = -(0.10 + 0.06*fo);               // espejado: ojo izquierdo

    // FUERZA: microtemblor de tensión con el Mangekyou al máximo
    var sh  = mk*mk*R*0.02;
    var shx = sh*Math.sin(t/23), shy = sh*Math.cos(t/31);

    // ojo almendrado ESPEJADO — canto externo a la izquierda, interno a la derecha
    function eyePath(){
      ctx.beginPath();
      ctx.moveTo(-RX, 0);
      ctx.bezierCurveTo(-RX*0.55, -upH, RX*0.45, -upH*1.05, RX, -RY*0.12);
      ctx.bezierCurveTo(RX*0.45, loH*0.75, -RX*0.5, loH, -RX, 0);
      ctx.closePath();
    }

    ctx.save();
    ctx.translate(cx + shx, cy + shy); ctx.rotate(tilt);

    eyePath();
    ctx.fillStyle = api.colors.bgColor || "#1e1e1e"; ctx.fill();

    ctx.save();
    eyePath(); ctx.clip();

    var ix = this.px, iy = this.py, r = R*0.68*(1 - 0.08*fo);

    // ESFUERZO: venas rojas en la esclerótica al concentrarse
    if (fo > 0.1){
      if (!this.veins){
        this.veins = [];
        for (var v = 0; v < 6; v++){
          var side = v < 3 ? -1 : 1;
          this.veins.push({
            a: side > 0 ? (Math.random()*0.7 - 0.35) : Math.PI + (Math.random()*0.7 - 0.35),
            wob: Math.random()*Math.PI*2,
            wy: (Math.random()-0.5)*RY*0.6
          });
        }
      }
      ctx.save();
      ctx.globalAlpha = 0.4*fo;
      ctx.strokeStyle = "#c22222"; ctx.lineWidth = 1.2;
      for (var v2 = 0; v2 < this.veins.length; v2++){
        var vn = this.veins[v2];
        var sx = Math.cos(vn.a)*RX*0.98, sy = Math.sin(vn.a)*RY*0.35 + vn.wy*0.3;
        var ex = ix + Math.cos(vn.a)*r*1.03, ey = iy + Math.sin(vn.a)*r*0.8 + vn.wy*0.15;
        var mxp = (sx+ex)/2 + Math.sin(vn.wob)*R*0.06;
        var myp = (sy+ey)/2 + Math.cos(vn.wob)*R*0.06;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mxp, myp, ex, ey); ctx.stroke();
      }
      ctx.restore();
    }

    // iris rojo — con AURA de chakra al concentrarse
    ctx.save();
    if (fo > 0.05){
      ctx.shadowColor = "rgba(255,30,30," + (0.75*fo).toFixed(2) + ")";
      ctx.shadowBlur = r*0.55*fo;
    }
    var g = ctx.createRadialGradient(ix,iy,r*0.1,ix,iy,r);
    g.addColorStop(0, mk>0.5 ? "#ff2020" : (fo>0.5 ? "#ff3b3b" : "#e02b2b"));
    g.addColorStop(1, "#6e0000");
    ctx.beginPath(); ctx.arc(ix,iy,r,0,Math.PI*2); ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    ctx.beginPath(); ctx.arc(ix,iy,r,0,Math.PI*2);
    ctx.lineWidth = r*0.12; ctx.strokeStyle = "#111"; ctx.stroke();

    ctx.beginPath(); ctx.arc(ix,iy,r*0.62,0,Math.PI*2);
    ctx.lineWidth = r*0.05; ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.stroke();

    var rot = t/(2200 - 900*fo);

    // ---------- MANGEKYOU (hover sostenido — 5 variantes aleatorias) ----------
    if (mk > 0.01){
      ctx.save();
      ctx.globalAlpha = mk;
      ctx.translate(ix, iy); ctx.rotate(rot);
      ctx.fillStyle = "#111"; ctx.strokeStyle = "#111";
      var j, k, a0;

      if (this.variant === 0){
        // Itachi — 3 aspas curvas + arcos interrumpidos
        for (j=0;j<3;j++){
          ctx.save(); ctx.rotate(j*Math.PI*2/3);
          ctx.beginPath();
          ctx.moveTo(0, -r*0.10);
          ctx.quadraticCurveTo(r*0.55, -r*0.62, r*0.86, -r*0.30);
          ctx.quadraticCurveTo(r*0.42, -r*0.18, 0, r*0.16);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.lineWidth = r*0.14;
        for (k=0;k<3;k++){
          a0 = k*Math.PI*2/3 + 0.35;
          ctx.beginPath(); ctx.arc(0,0,r*0.80, a0, a0 + Math.PI*0.55); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0,0,r*0.20,0,Math.PI*2); ctx.fill();

      } else if (this.variant === 1){
        // Sasuke — estrella de 6 puntas (dos triángulos entrelazados)
        ctx.lineWidth = r*0.13; ctx.lineJoin = "round";
        for (j=0;j<2;j++){
          ctx.save(); ctx.rotate(j*Math.PI/3);
          ctx.beginPath();
          for (k=0;k<3;k++){
            var av = -Math.PI/2 + k*Math.PI*2/3;
            var pxv = Math.cos(av)*r*0.82, pyv = Math.sin(av)*r*0.82;
            if (k===0) ctx.moveTo(pxv,pyv); else ctx.lineTo(pxv,pyv);
          }
          ctx.closePath(); ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0,0,r*0.18,0,Math.PI*2); ctx.fill();

      } else if (this.variant === 2){
        // Kakashi — molinete de 3 aspas rectas con gancho
        for (j=0;j<3;j++){
          ctx.save(); ctx.rotate(j*Math.PI*2/3);
          ctx.beginPath();
          ctx.moveTo(0, -r*0.12);
          ctx.lineTo(r*0.22, -r*0.85);
          ctx.lineTo(r*0.62, -r*0.68);
          ctx.lineTo(r*0.30, -r*0.42);
          ctx.lineTo(r*0.14, 0);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0,0,r*0.22,0,Math.PI*2); ctx.fill();

      } else if (this.variant === 3){
        // Shisui — shuriken curvo de 4 aspas
        for (j=0;j<4;j++){
          ctx.save(); ctx.rotate(j*Math.PI/2);
          ctx.beginPath();
          ctx.moveTo(0, -r*0.12);
          ctx.quadraticCurveTo(r*0.50, -r*0.75, r*0.88, -r*0.35);
          ctx.quadraticCurveTo(r*0.38, -r*0.22, 0, r*0.14);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0,0,r*0.24,0,Math.PI*2); ctx.fill();

      } else {
        // Anillo con 3 tomoe-gancho sobre el borde (estilo eterno)
        ctx.lineWidth = r*0.15;
        for (k=0;k<3;k++){
          a0 = k*Math.PI*2/3 + 0.45;
          ctx.beginPath(); ctx.arc(0,0,r*0.72, a0, a0 + Math.PI*0.50); ctx.stroke();
          // gancho al final de cada arco, apuntando al centro
          var ah = a0 + Math.PI*0.50;
          var hx = Math.cos(ah)*r*0.72, hy = Math.sin(ah)*r*0.72;
          ctx.save(); ctx.translate(hx,hy); ctx.rotate(ah + Math.PI/2);
          ctx.beginPath();
          ctx.moveTo(0,0);
          ctx.quadraticCurveTo(-r*0.22, r*0.18, -r*0.08, r*0.40);
          ctx.quadraticCurveTo(-r*0.05, r*0.15, 0, 0);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0,0,r*0.22,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }

    // ---------- SHARINGAN NORMAL (por defecto) ----------
    if (mk < 0.99){
      ctx.save();
      ctx.globalAlpha = 1 - mk;
      ctx.beginPath(); ctx.arc(ix,iy,r*0.22*(1-0.25*fo),0,Math.PI*2);
      ctx.fillStyle = "#111"; ctx.fill();
      for (var i=0;i<3;i++){
        var a = rot + i*Math.PI*2/3;
        ctx.save();
        ctx.translate(ix + Math.cos(a)*r*0.58, iy + Math.sin(a)*r*0.58);
        ctx.rotate(a+Math.PI/2);
        ctx.fillStyle = "#111";
        ctx.beginPath(); ctx.arc(0,0,r*0.15,0,Math.PI*2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(r*0.13,0);
        ctx.quadraticCurveTo(r*0.34,r*0.22, r*0.06,r*0.42);
        ctx.quadraticCurveTo(r*0.20,r*0.16, 0,r*0.13);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // brillo especular (espejado hacia el otro lado)
    ctx.beginPath(); ctx.arc(ix+r*0.2, iy-r*0.22, r*0.13, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fill();
    ctx.restore();

    eyePath();
    ctx.lineWidth = 2 + 1.2*fo; ctx.strokeStyle = "#888"; ctx.stroke();

    // párpado superior espejado — se marca más con la concentración
    ctx.beginPath();
    ctx.moveTo(-RX, 0);
    ctx.bezierCurveTo(-RX*0.55, -upH, RX*0.45, -upH*1.05, RX, -RY*0.12);
    ctx.lineWidth = 3 + 2*fo; ctx.lineCap = "round"; ctx.strokeStyle = "#aaa"; ctx.stroke();

    ctx.restore();
  }
};