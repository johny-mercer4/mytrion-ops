import{E as n,F as o}from"./index.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const t=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"m9 14 2 2 4-4",key:"df797q"}]],l=n("clipboard-check",t);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c=[["path",{d:"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",key:"1miecu"}]],d=n("paperclip",c);async function g(e={}){var r;const s=await o("GET","/inbox/messages",{query:{...e.actAsId?{owner_id:e.actAsId}:{},limit:e.limit??25,offset:e.offset??0,...e.cursor?{cursor:e.cursor}:{},...(r=e.query)!=null&&r.trim()?{q:e.query.trim()}:{},filter:e.filter??"all",...e.tag?{tag:e.tag}:{}},...e.signal?{signal:e.signal}:{}}),a=s.messages??[];return{messages:a,counts:s.counts??{all:a.length,unread:0,task:0,alert:0,reminder:0},pagination:s.pagination??{limit:e.limit??25,offset:e.offset??0,total:a.length,hasMore:!1,cursor:e.cursor??null,nextCursor:null}}}async function m(e){return(await o("GET","/inbox/messages/counts",{query:e?{owner_id:e}:{}})).counts}async function y(e,s,a){await o("POST",`/inbox/messages/${encodeURIComponent(e)}/read`,{query:a?{owner_id:a}:{},body:{read:s}})}async function f(e){await o("POST","/inbox/messages/read-all",{query:e?{owner_id:e}:{},body:{}})}async function u(e,s){await o("POST",`/inbox/messages/${encodeURIComponent(e)}/delete`,{query:s?{owner_id:s}:{},body:{}})}export{l as C,d as P,u as d,m as g,g as l,f as m,y as s};
