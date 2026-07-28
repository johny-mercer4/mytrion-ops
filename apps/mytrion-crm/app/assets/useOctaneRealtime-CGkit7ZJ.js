import{c as u,a as m,i as x,ar as v,as as w,at as b}from"./index-3MYcnXrj.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]],M=u("circle-pause",g);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=[["path",{d:"m11 17 2 2a1 1 0 1 0 3-3",key:"efffak"}],["path",{d:"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",key:"9pr0kb"}],["path",{d:"m21 3 1 11h-2",key:"1tisrp"}],["path",{d:"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",key:"1uvwmv"}],["path",{d:"M3 4h8",key:"1ep09j"}]],N=u("handshake",$);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]],R=u("user-plus",T);function U(n){const{baseUrl:o}=w(),t=b(o,`/realtime?token=${encodeURIComponent(n)}`);return t.startsWith("https://")?`wss://${t.slice(8)}`:t.startsWith("http://")?`ws://${t.slice(7)}`:`${window.location.protocol==="https:"?"wss":"ws"}://${window.location.host}${t.startsWith("/")?t:`/${t}`}`}function S(n){const o=m.useRef(n);o.current=n;const t=(n.extraTopics??[]).slice().sort().join("|");m.useEffect(()=>{if(n.enabled===!1)return;let r=!1,i=1,a=null,e=null;const h=async()=>{var f,d;if(r)return;let s=(f=x())==null?void 0:f.accessToken;if(s||(s=await v()?(d=x())==null?void 0:d.accessToken:void 0),!(!s||r)){try{e=new WebSocket(U(s))}catch{y();return}e.onopen=()=>{i=1;const l=o.current.extraTopics??[];for(const c of l)try{e==null||e.send(JSON.stringify({action:"subscribe",topic:c}))}catch{}},e.onmessage=l=>{var p,k;let c;try{c=JSON.parse(String(l.data))}catch{return}c.kind!=="event"||!c.event||(k=(p=o.current).onInboxEvent)==null||k.call(p,c.event)},e.onclose=()=>{e=null,r||y()},e.onerror=()=>{try{e==null||e.close()}catch{}}}},y=()=>{if(r||a)return;const s=Math.min(3e4,1e3*i);i=Math.min(i+1,30),a=setTimeout(()=>{a=null,h()},s)};return h(),()=>{r=!0,a&&clearTimeout(a);try{e==null||e.close()}catch{}e=null}},[n.enabled,t])}export{M as C,N as H,R as U,S as u};
