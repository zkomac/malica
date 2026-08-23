/* Kompakten QR generator (byte mode, ECC L/M/Q/H), samostojen, brez odvisnosti.
   Port po javni domeni (Project Nayuki, QR Code generator). Vrne matriko modulov. */
(function(global){
  "use strict";
  function QrSegment(mode, numChars, bitData){ this.mode=mode; this.numChars=numChars; this.bitData=bitData; }
  var Mode = { BYTE:{modeBits:0x4, numBitsCharCount:[8,16,16]} };
  function getNumBitsCharCount(mode, ver){ return mode.numBitsCharCount[Math.floor((ver+7)/17)]; }

  function makeBytes(data){ // data: array of bytes
    var bb=[];
    for(var i=0;i<data.length;i++) for(var j=7;j>=0;j--) bb.push((data[i]>>>j)&1);
    return new QrSegment(Mode.BYTE, data.length, bb);
  }
  function utf8(str){
    var out=[]; for(var i=0;i<str.length;i++){ var c=str.charCodeAt(i);
      if(c<0x80) out.push(c);
      else if(c<0x800){ out.push(0xC0|(c>>6)); out.push(0x80|(c&0x3F)); }
      else if(c<0xD800||c>=0xE000){ out.push(0xE0|(c>>12)); out.push(0x80|((c>>6)&0x3F)); out.push(0x80|(c&0x3F)); }
      else { i++; var c2=((c&0x3FF)<<10)+(str.charCodeAt(i)&0x3FF)+0x10000; out.push(0xF0|(c2>>18)); out.push(0x80|((c2>>12)&0x3F)); out.push(0x80|((c2>>6)&0x3F)); out.push(0x80|(c2&0x3F)); }
    } return out;
  }

  var ECC = { L:{ord:0, fb:1}, M:{ord:1, fb:0}, Q:{ord:2, fb:3}, H:{ord:3, fb:2} };
  // ECC codewords per block & blocks per version, indexed [ecl.ord][ver]
  var ECC_CODEWORDS_PER_BLOCK = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  ];
  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,38,40,43,45,48,51,53,56,59,62,65,68,71,74]
  ];
  function numRawDataModules(ver){
    var result=(16*ver+128)*ver+64;
    if(ver>=2){ var na=Math.floor(ver/7)+2; result-=(25*na-10)*na-55; if(ver>=7) result-=36; }
    return result;
  }
  function numDataCodewords(ver, ecl){
    return Math.floor(numRawDataModules(ver)/8) - ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver]*NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
  }

  // Reed-Solomon in GF(256)
  function rsMul(x,y){ var z=0; for(var i=7;i>=0;i--){ z=(z<<1)^((z>>>7)*0x11D); z^=((y>>>i)&1)*x; } return z&0xFF; }
  function rsDivisor(degree){
    var result=[]; for(var i=0;i<degree-1;i++) result.push(0); result.push(1);
    var root=1;
    for(var i=0;i<degree;i++){ for(var j=0;j<result.length;j++){ result[j]=rsMul(result[j],root); if(j+1<result.length) result[j]^=result[j+1]; } root=rsMul(root,0x02); }
    return result;
  }
  function rsRemainder(data, divisor){
    var result=divisor.map(function(){return 0;});
    data.forEach(function(b){ var factor=b^result.shift(); result.push(0); divisor.forEach(function(cf,i){ result[i]^=rsMul(cf,factor); }); });
    return result;
  }

  function QrCode(ver, ecl, dataCodewords, mask){
    this.version=ver; this.size=ver*4+17; this.ecl=ecl;
    var row=[]; for(var i=0;i<this.size;i++) row.push(false);
    this.modules=[]; this.isFunction=[];
    for(var i=0;i<this.size;i++){ this.modules.push(row.slice()); this.isFunction.push(row.slice()); }
    this.drawFunctionPatterns();
    var allCodewords=this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    if(mask<0){ var minPen=Infinity;
      for(var m=0;m<8;m++){ this.applyMask(m); this.drawFormatBits(m); var p=this.getPenaltyScore(); if(p<minPen){ mask=m; minPen=p; } this.applyMask(m); }
    }
    this.mask=mask; this.applyMask(mask); this.drawFormatBits(mask);
  }
  QrCode.prototype.setFunctionModule=function(x,y,isDark){ this.modules[y][x]=isDark; this.isFunction[y][x]=true; };
  QrCode.prototype.drawFunctionPatterns=function(){
    var size=this.size;
    for(var i=0;i<size;i++){ this.setFunctionModule(6,i,i%2===0); this.setFunctionModule(i,6,i%2===0); }
    this.drawFinderPattern(3,3); this.drawFinderPattern(size-4,3); this.drawFinderPattern(3,size-4);
    var alignPos=this.getAlignmentPatternPositions(); var n=alignPos.length;
    for(var i=0;i<n;i++) for(var j=0;j<n;j++){ if(!((i===0&&j===0)||(i===0&&j===n-1)||(i===n-1&&j===0))) this.drawAlignmentPattern(alignPos[i],alignPos[j]); }
    this.drawFormatBits(0);
    this.drawVersion();
  };
  QrCode.prototype.drawFinderPattern=function(x,y){
    for(var dy=-4;dy<=4;dy++) for(var dx=-4;dx<=4;dx++){
      var dist=Math.max(Math.abs(dx),Math.abs(dy)); var xx=x+dx, yy=y+dy;
      if(0<=xx&&xx<this.size&&0<=yy&&yy<this.size) this.setFunctionModule(xx,yy,dist!==2&&dist!==4);
    }
  };
  QrCode.prototype.drawAlignmentPattern=function(x,y){
    for(var dy=-2;dy<=2;dy++) for(var dx=-2;dx<=2;dx++) this.setFunctionModule(x+dx,y+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  };
  QrCode.prototype.getAlignmentPatternPositions=function(){
    if(this.version===1) return [];
    var num=Math.floor(this.version/7)+2;
    var step=(this.version===32)?26:Math.ceil((this.version*4+4)/(num*2-2))*2;
    var result=[6]; for(var pos=this.size-7;result.length<num;pos-=step) result.splice(1,0,pos);
    return result;
  };
  QrCode.prototype.drawFormatBits=function(mask){
    var data=(this.ecl.fb<<3)|mask; var rem=data;
    for(var i=0;i<10;i++) rem=(rem<<1)^((rem>>>9)*0x537);
    var bits=((data<<10)|rem)^0x5412;
    for(var i=0;i<=5;i++) this.setFunctionModule(8,i,((bits>>>i)&1)!==0);
    this.setFunctionModule(8,7,((bits>>>6)&1)!==0); this.setFunctionModule(8,8,((bits>>>7)&1)!==0); this.setFunctionModule(7,8,((bits>>>8)&1)!==0);
    for(var i=9;i<15;i++) this.setFunctionModule(14-i,8,((bits>>>i)&1)!==0);
    for(var i=0;i<8;i++) this.setFunctionModule(this.size-1-i,8,((bits>>>i)&1)!==0);
    for(var i=8;i<15;i++) this.setFunctionModule(8,this.size-15+i,((bits>>>i)&1)!==0);
    this.setFunctionModule(8,this.size-8,true);
  };
  QrCode.prototype.drawVersion=function(){
    if(this.version<7) return;
    var rem=this.version; for(var i=0;i<12;i++) rem=(rem<<1)^((rem>>>11)*0x1F25);
    var bits=(this.version<<12)|rem;
    for(var i=0;i<18;i++){ var bit=((bits>>>i)&1)!==0; var a=this.size-11+i%3, b=Math.floor(i/3); this.setFunctionModule(a,b,bit); this.setFunctionModule(b,a,bit); }
  };
  QrCode.prototype.addEccAndInterleave=function(data){
    var ver=this.version, ecl=this.ecl;
    var numBlocks=NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
    var blockEccLen=ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver];
    var rawCodewords=Math.floor(numRawDataModules(ver)/8);
    var numShortBlocks=numBlocks-rawCodewords%numBlocks;
    var shortBlockLen=Math.floor(rawCodewords/numBlocks);
    var blocks=[]; var rsDiv=rsDivisor(blockEccLen); var k=0;
    for(var i=0;i<numBlocks;i++){
      var dat=data.slice(k, k+shortBlockLen-blockEccLen+(i<numShortBlocks?0:1)); k+=dat.length;
      var ecc=rsRemainder(dat, rsDiv);
      if(i<numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result=[];
    for(var i=0;i<blocks[0].length;i++) for(var j=0;j<blocks.length;j++){ if(i!==shortBlockLen-blockEccLen||j>=numShortBlocks) result.push(blocks[j][i]); }
    return result;
  };
  QrCode.prototype.drawCodewords=function(data){
    var size=this.size, i=0;
    for(var right=size-1; right>=1; right-=2){ if(right===6) right=5;
      for(var vert=0;vert<size;vert++) for(var j=0;j<2;j++){
        var x=right-j; var upward=((right+1)&2)===0; var y=upward?size-1-vert:vert;
        if(!this.isFunction[y][x] && i<data.length*8){ this.modules[y][x]=((data[i>>>3]>>>(7-(i&7)))&1)!==0; i++; }
      }
    }
  };
  QrCode.prototype.applyMask=function(mask){
    for(var y=0;y<this.size;y++) for(var x=0;x<this.size;x++){
      if(this.isFunction[y][x]) continue; var invert;
      switch(mask){ case 0: invert=(x+y)%2===0;break; case 1: invert=y%2===0;break; case 2: invert=x%3===0;break; case 3: invert=(x+y)%3===0;break;
        case 4: invert=(Math.floor(x/3)+Math.floor(y/2))%2===0;break; case 5: invert=x*y%2+x*y%3===0;break; case 6: invert=(x*y%2+x*y%3)%2===0;break; case 7: invert=((x+y)%2+x*y%3)%2===0;break; }
      this.modules[y][x]=this.modules[y][x]!==invert;
    }
  };
  QrCode.prototype.getPenaltyScore=function(){
    var size=this.size, result=0, mods=this.modules;
    for(var y=0;y<size;y++){ var run=0, color=false; for(var x=0;x<size;x++){ if(mods[y][x]===color) { run++; if(run===5) result+=3; else if(run>5) result++; } else { color=mods[y][x]; run=1; } } }
    for(var x=0;x<size;x++){ var run=0, color=false; for(var y=0;y<size;y++){ if(mods[y][x]===color){ run++; if(run===5) result+=3; else if(run>5) result++; } else { color=mods[y][x]; run=1; } } }
    for(var y=0;y<size-1;y++) for(var x=0;x<size-1;x++){ var c=mods[y][x]; if(c===mods[y][x+1]&&c===mods[y+1][x]&&c===mods[y+1][x+1]) result+=3; }
    var dark=0; mods.forEach(function(r){ r.forEach(function(c){ if(c) dark++; }); });
    var total=size*size; var k=Math.ceil(Math.abs(dark*20-total*10)/total)-1; result+=k*10;
    return result;
  };

  function encodeText(text, ecl){
    if(typeof ecl==="string") ecl=ECC[ecl]||ECC.M;
    if(!ecl) ecl=ECC.M;
    var data=utf8(text);
    var seg=makeBytes(data);
    // pick smallest version 1..40 that fits
    for(var ver=1;ver<=40;ver++){
      var dataCap=numDataCodewords(ver, ecl)*8;
      var ccbits=getNumBitsCharCount(seg.mode, ver);
      var usedBits=4+ccbits+seg.bitData.length;
      if(seg.numChars < (1<<ccbits) && usedBits<=dataCap){
        // build bit buffer
        var bb=[]; function append(val,len){ for(var i=len-1;i>=0;i--) bb.push((val>>>i)&1); }
        append(seg.mode.modeBits,4); append(seg.numChars,ccbits); for(var i=0;i<seg.bitData.length;i++) bb.push(seg.bitData[i]);
        var cap=numDataCodewords(ver,ecl)*8;
        append(0, Math.min(4, cap-bb.length));
        append(0,(8-bb.length%8)%8);
        for(var pad=0xEC; bb.length<cap; pad^=0xEC^0x11) append(pad,8);
        var codewords=[]; for(var i=0;i<bb.length;i+=8){ var b=0; for(var j=0;j<8;j++) b=(b<<1)|bb[i+j]; codewords.push(b); }
        return new QrCode(ver, ecl, codewords, -1);
      }
    }
    throw new Error("Podatki predolgi za QR");
  }

  // Nariše QR na canvas element; scale = velikost enega modula (px)
  function toCanvas(canvas, text, opt){
    opt=opt||{}; var ecl=ECC[opt.ecl||"M"]; var qr=encodeText(text, ecl);
    var border=opt.border==null?2:opt.border; var scale=opt.scale||6;
    var dim=(qr.size+border*2)*scale;
    canvas.width=dim; canvas.height=dim; var ctx=canvas.getContext("2d");
    ctx.fillStyle=opt.light||"#fff"; ctx.fillRect(0,0,dim,dim);
    ctx.fillStyle=opt.dark||"#000";
    for(var y=0;y<qr.size;y++) for(var x=0;x<qr.size;x++) if(qr.modules[y][x]) ctx.fillRect((x+border)*scale,(y+border)*scale,scale,scale);
    return canvas;
  }
  global.QR = { toCanvas: toCanvas, encodeText: encodeText };
})(window);
