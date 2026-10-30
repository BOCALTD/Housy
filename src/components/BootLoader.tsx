import { PLATFORM_NAME } from "@/lib/labels";

/**
 * The opening loader, shown once per visit (per browser tab session): a magnifying glass circling a turning globe while the
 * counter climbs from 0% to 100% as the page actually loads. At 100% it turns green, clicks, and two doors swing open onto the
 * site (or onto the welcome slides for a first-time visitor). It is drawn by the server so it appears before anything else,
 * runs on a few lines of plain script, and never blocks: it finishes within 6 seconds whatever happens, is skipped for the
 * rest of the visit, and is not shown at all without JavaScript or to automated browsers. The script only switches classes
 * on <html>, so the page React hydrates is exactly the page the server sent.
 */
export function BootLoader() {
  return (
    <>
      <div id="boot" className="boot" role="status" aria-live="polite" aria-label={`Opening ${PLATFORM_NAME}`}>
        <div className="boot-door boot-door-l" aria-hidden="true"><span className="boot-knob" /></div>
        <div className="boot-door boot-door-r" aria-hidden="true"><span className="boot-knob" /></div>
        <div className="boot-core">
          <div className="boot-stage" aria-hidden="true">
            <svg className="boot-ring" viewBox="0 0 120 120"><circle className="boot-ring-bg" cx="60" cy="60" r="56" /><circle id="boot-arc" className="boot-ring-fg" cx="60" cy="60" r="56" /></svg>
            <svg className="boot-globe" viewBox="0 0 100 100">
              <defs><clipPath id="boot-clip"><circle cx="50" cy="50" r="34" /></clipPath><radialGradient id="boot-sea" cx="38%" cy="32%"><stop offset="0" stopColor="#3B4048" /><stop offset="1" stopColor="#1A1C20" /></radialGradient></defs>
              <circle cx="50" cy="50" r="34" fill="url(#boot-sea)" />
              <g clipPath="url(#boot-clip)" className="boot-land">
                <g className="boot-spin">
                  {[0, 1].map((k) => (
                    <g key={k} transform={`translate(${k * 136} 0)`} fill="#FBB017" opacity=".85">
                      <path d="M6 30c8-6 18-6 22 2s-2 14 4 20-2 16-10 12-10-12-16-14-8-14 0-20Z" />
                      <path d="M44 22c8-2 16 2 18 8s-4 8 0 14 10 6 8 14-10 14-16 8-2-14-8-18-10-4-8-12 2-12 6-14Z" />
                      <path d="M86 26c10-4 22 0 26 8s-6 10-2 16 8 10 2 14-14-4-18-10-12-2-12-10 0-14 4-18Z" />
                      <path d="M100 66c6-2 12 2 12 6s-6 8-12 6-6-10 0-12Z" />
                    </g>
                  ))}
                </g>
              </g>
              <g fill="none" stroke="#FFFFFF" strokeOpacity=".22" strokeWidth=".8">
                <circle cx="50" cy="50" r="34" />
                <ellipse cx="50" cy="50" rx="34" ry="12" /><ellipse cx="50" cy="50" rx="34" ry="24" />
                <ellipse cx="50" cy="50" rx="12" ry="34" /><ellipse cx="50" cy="50" rx="24" ry="34" /><path d="M50 16v68M16 50h68" />
              </g>
            </svg>
            <div className="boot-orbit"><span className="boot-lens">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" fill="rgba(255,255,255,.18)" /><path d="m15.5 15.5 5 5" /></svg>
            </span></div>
            <svg className="boot-tick" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </div>
          <p className="boot-pct"><span id="boot-n">0</span>%</p>
          <p className="boot-name">{PLATFORM_NAME}</p>
          <p className="boot-sub">Searching for property you can trust</p>
        </div>
      </div>
      <noscript><style>{".boot{display:none!important}"}</style></noscript>
      {/* Runs straight away, before the page is interactive. Plain script: no framework, nothing to download. */}
      <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
    </>
  );
}

const BOOT_SCRIPT = `(function(){
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
})();`;
