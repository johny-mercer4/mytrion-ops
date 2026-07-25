import{v as o,a as v,h as x,am as m,an as w,ao as M}from"./index-CZv2S18N.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]],U=o("circle-pause",_);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=[["path",{d:"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5",key:"1wtuz0"}],["path",{d:"M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16",key:"e09ifn"}],["path",{d:"M2 21h13",key:"1x0fut"}],["path",{d:"M3 9h11",key:"1p7c0w"}]],R=o("fuel",$);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=[["path",{d:"m11 17 2 2a1 1 0 1 0 3-3",key:"efffak"}],["path",{d:"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",key:"9pr0kb"}],["path",{d:"m21 3 1 11h-2",key:"1tisrp"}],["path",{d:"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",key:"1uvwmv"}],["path",{d:"M3 4h8",key:"1ep09j"}]],C=o("handshake",g);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=[["path",{d:"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",key:"9njp5v"}]],H=o("phone",b);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N=[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],P=o("sparkles",N);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]],W=o("user-plus",T);function S(n){const{baseUrl:c}=w(),t=M(c,`/realtime?token=${encodeURIComponent(n)}`);return t.startsWith("https://")?`wss://${t.slice(8)}`:t.startsWith("http://")?`ws://${t.slice(7)}`:`${window.location.protocol==="https:"?"wss":"ws"}://${window.location.host}${t.startsWith("/")?t:`/${t}`}`}function q(n){const c=v.useRef(n);c.current=n;const t=(n.extraTopics??[]).slice().sort().join("|");v.useEffect(()=>{if(n.enabled===!1)return;let a=!1,i=1,l=null,e=null;const y=async()=>{var p,d;if(a)return;let s=(p=x())==null?void 0:p.accessToken;if(s||(s=await m()?(d=x())==null?void 0:d.accessToken:void 0),!(!s||a)){try{e=new WebSocket(S(s))}catch{u();return}e.onopen=()=>{i=1;const h=c.current.extraTopics??[];for(const r of h)try{e==null||e.send(JSON.stringify({action:"subscribe",topic:r}))}catch{}},e.onmessage=h=>{var f,k;let r;try{r=JSON.parse(String(h.data))}catch{return}r.kind!=="event"||!r.event||(k=(f=c.current).onInboxEvent)==null||k.call(f,r.event)},e.onclose=()=>{e=null,a||u()},e.onerror=()=>{try{e==null||e.close()}catch{}}}},u=()=>{if(a||l)return;const s=Math.min(3e4,1e3*i);i=Math.min(i+1,30),l=setTimeout(()=>{l=null,y()},s)};return y(),()=>{a=!0,l&&clearTimeout(l);try{e==null||e.close()}catch{}e=null}},[n.enabled,t])}export{U as C,R as F,C as H,H as P,P as S,W as U,q as u};
