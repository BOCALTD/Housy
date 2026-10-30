/* The opening loader (src/components/BootLoader.tsx): counts real loading to 100%, then opens the doors. Plain script that only
 * switches classes on <html>, so the page React hydrates is exactly the page the server sent. */
(function(){
var el=document.getElementById("boot");if(!el)return;
var q=location.search;
var H=document.documentElement;
try{if(!/[?&]boot=1/.test(q)&&(navigator.webdriver||sessionStorage.getItem("boot-seen"))){H.classList.add("boot-off");return;}sessionStorage.setItem("boot-seen","1");}catch(e){}
H.classList.add("booting");
var n=document.getElementById("boot-n"),arc=document.getElementById("boot-arc"),shown=0,target=12,t0=Date.now(),done=false,L=2*Math.PI*56;
if(arc){arc.style.strokeDasharray=L;arc.style.strokeDashoffset=L;}
function aim(v){if(v>target)target=v;}
if(document.readyState!=="loading")aim(55);else document.addEventListener("DOMContentLoaded",function(){aim(55);});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){aim(80);});
if(document.readyState==="complete")aim(100);else window.addEventListener("load",function(){aim(100);});
setTimeout(function(){aim(100);},6000);
function tick(){
 var age=Date.now()-t0,cap=Math.min(target,age<1300?Math.floor(age/13):100);
 if(shown<cap)shown+=Math.max(1,Math.round((cap-shown)/7));
 if(shown>100)shown=100;
 if(n)n.textContent=shown;if(arc)arc.style.strokeDashoffset=L*(1-shown/100);
 if(shown>=100&&!done){done=true;finish();return;}
 if(!done)requestAnimationFrame(tick);
}
function click(){try{var C=window.AudioContext||window.webkitAudioContext;if(!C)return;var c=new C();if(c.state!=="running")return;var o=c.createOscillator(),g=c.createGain();o.type="triangle";o.frequency.value=1400;g.gain.setValueAtTime(.12,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.08);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.09);}catch(e){}}
function finish(){
 el.classList.add("is-done");click();
 setTimeout(function(){el.classList.add("is-open");},520);
 setTimeout(function(){H.classList.add("boot-off");H.classList.remove("booting");document.dispatchEvent(new Event("boot:done"));},1500);
}
requestAnimationFrame(tick);
})();
