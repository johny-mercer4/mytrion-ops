import{w as i,a as m,h as v,aq as x,ar as w,as as $}from"./index-DVUBtf2m.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],U=i("circle-check",g);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]],R=i("circle-pause",_);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=[["path",{d:"m11 17 2 2a1 1 0 1 0 3-3",key:"efffak"}],["path",{d:"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",key:"9pr0kb"}],["path",{d:"m21 3 1 11h-2",key:"1tisrp"}],["path",{d:"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",key:"1uvwmv"}],["path",{d:"M3 4h8",key:"1ep09j"}]],S=i("handshake",b);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T=[["path",{d:"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",key:"9njp5v"}]],j=i("phone",T);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]],P=i("user-plus",N);function C(n){const{baseUrl:a}=w(),t=$(a,`/realtime?token=${encodeURIComponent(n)}`);return t.startsWith("https://")?`wss://${t.slice(8)}`:t.startsWith("http://")?`ws://${t.slice(7)}`:`${window.location.protocol==="https:"?"wss":"ws"}://${window.location.host}${t.startsWith("/")?t:`/${t}`}`}function W(n){const a=m.useRef(n);a.current=n;const t=(n.extraTopics??[]).slice().sort().join("|");m.useEffect(()=>{if(n.enabled===!1)return;let c=!1,l=1,o=null,e=null;const y=async()=>{var d,p;if(c)return;let r=(d=v())==null?void 0:d.accessToken;if(r||(r=await x()?(p=v())==null?void 0:p.accessToken:void 0),!(!r||c)){try{e=new WebSocket(C(r))}catch{u();return}e.onopen=()=>{l=1;const h=a.current.extraTopics??[];for(const s of h)try{e==null||e.send(JSON.stringify({action:"subscribe",topic:s}))}catch{}},e.onmessage=h=>{var f,k;let s;try{s=JSON.parse(String(h.data))}catch{return}s.kind!=="event"||!s.event||(k=(f=a.current).onInboxEvent)==null||k.call(f,s.event)},e.onclose=()=>{e=null,c||u()},e.onerror=()=>{try{e==null||e.close()}catch{}}}},u=()=>{if(c||o)return;const r=Math.min(3e4,1e3*l);l=Math.min(l+1,30),o=setTimeout(()=>{o=null,y()},r)};return y(),()=>{c=!0,o&&clearTimeout(o);try{e==null||e.close()}catch{}e=null}},[n.enabled,t])}export{R as C,S as H,j as P,P as U,U as a,W as u};
