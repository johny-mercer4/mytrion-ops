import{c as l,a as f}from"./index-tWjFj-U2.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",key:"1nb95v"}],["line",{x1:"8",x2:"16",y1:"6",y2:"6",key:"x4nwl0"}],["line",{x1:"16",x2:"16",y1:"14",y2:"18",key:"wjye3r"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M8 18h.01",key:"lrp35t"}]],m=l("calculator",y);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]],b=l("link-2",h),k=["a[href]","button:not([disabled])","input:not([disabled])","select:not([disabled])","textarea:not([disabled])",'[tabindex]:not([tabindex="-1"])'].join(",");function x(){const o=f.useRef(null);return f.useEffect(()=>{const t=o.current;if(!t)return;const r=document.activeElement,n=()=>Array.from(t.querySelectorAll(k)).filter(e=>e.offsetParent!==null||e===document.activeElement);(n().find(e=>!e.hasAttribute("data-focus-skip"))??t).focus();const u=e=>{if(e.key!=="Tab")return;const a=n();if(a.length===0)return;const c=a[0],d=a[a.length-1],i=document.activeElement;!e.shiftKey&&i===d?(e.preventDefault(),c.focus()):e.shiftKey&&i===c?(e.preventDefault(),d.focus()):i&&!t.contains(i)&&(e.preventDefault(),c.focus())};return t.addEventListener("keydown",u),()=>{t.removeEventListener("keydown",u),r&&document.body.contains(r)&&r.focus()}},[]),o}function w(o,t,r){return n=>{const s=n.key==="ArrowRight"||n.key==="ArrowDown"?1:n.key==="ArrowLeft"||n.key==="ArrowUp"?-1:0;s!==0&&(n.preventDefault(),r((t+s+o)%o))}}function M(o,t,r){return r?o?0:-1:t?0:-1}export{m as C,b as L,M as a,w as r,x as u};
