import{a as i,j as o}from"./index-DPlT0ETX.js";import{D as C,a as N,b as k,d as S,e as D,f as A,c as d,u as L,m as E,g as W}from"./MytrionShell-DQRQG4cg.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=(...e)=>e.filter((r,t,a)=>!!r&&r.trim()!==""&&a.indexOf(r)===t).join(" ").trim();/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(r,t,a)=>a?a.toUpperCase():t.toLowerCase());/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=e=>{const r=R(e);return r.charAt(0).toUpperCase()+r.slice(1)};/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var m={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=e=>{for(const r in e)if(r.startsWith("aria-")||r==="role"||r==="title")return!0;return!1},T=i.createContext({}),$=()=>i.useContext(T),z=i.forwardRef(({color:e,size:r,strokeWidth:t,absoluteStrokeWidth:a,className:n="",children:s,iconNode:c,...l},p)=>{const{size:u=24,strokeWidth:x=2,absoluteStrokeWidth:b=!1,color:h="currentColor",className:v=""}=$()??{},w=a??b?Number(t??x)*24/Number(r??u):t??x;return i.createElement("svg",{ref:p,...m,width:r??u??m.width,height:r??u??m.height,stroke:e??h,strokeWidth:w,className:f("lucide",v,n),...!s&&!_(l)&&{"aria-hidden":"true"},...l},[...c.map(([y,j])=>i.createElement(y,j)),...Array.isArray(s)?s:[s]])});/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=(e,r)=>{const t=i.forwardRef(({className:a,...n},s)=>i.createElement(z,{ref:s,iconNode:r,className:f(`lucide-${B(g(e))}`,`lucide-${e}`,a),...n}));return t.displayName=g(e),t};/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const P=[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]],Z=I("search",P),F={md:"sm:max-w-md",lg:"sm:max-w-2xl",xl:"sm:max-w-4xl"};function G({open:e,onOpenChange:r,title:t,subtitle:a,badges:n,footer:s,children:c,size:l="lg"}){return o.jsx(C,{open:e,onOpenChange:r,children:o.jsxs(N,{className:d(F[l],"max-h-[88vh] overflow-hidden p-0"),children:[o.jsxs(k,{className:"gap-1.5 border-b px-5 pt-5 pb-4",children:[o.jsx(S,{className:"font-heading text-lg font-bold",children:t}),a?o.jsx(D,{children:a}):null,n?o.jsx("div",{className:"flex flex-wrap gap-1.5 pt-1",children:n}):null]}),o.jsx("div",{className:"max-h-[60vh] overflow-y-auto px-5 py-4",children:c}),s?o.jsx(A,{className:"mx-0 mb-0 rounded-b-xl",children:s}):null]})})}function O(e){return L(e.defaultTagName??"div",e,e)}const U=W("group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",{variants:{variant:{default:"bg-primary text-primary-foreground [a]:hover:bg-primary/80",secondary:"bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",destructive:"bg-destructive/10 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20",outline:"border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",ghost:"hover:bg-muted hover:text-muted-foreground",link:"text-primary underline-offset-4 hover:underline"}},defaultVariants:{variant:"default"}});function V({className:e,variant:r="default",render:t,...a}){return O({defaultTagName:"span",props:E({className:d(U({variant:r}),e)},a),render:t,state:{slot:"badge",variant:r}})}const H={good:"border-good/30 bg-good/10 text-good",warn:"border-warn/30 bg-warn/10 text-warn",bad:"border-bad/30 bg-bad/10 text-bad",info:"border-primary/30 bg-primary/10 text-primary",neutral:"border-border bg-muted text-muted-foreground"};function J({tone:e="neutral",className:r,children:t,...a}){return o.jsx(V,{variant:"outline",className:d(H[e],"font-medium",r),...a,children:t})}function M({className:e,...r}){return o.jsxs("div",{className:d("flex items-center gap-2 rounded-md border bg-card px-3 py-2 transition-colors focus-within:border-primary/55 focus-within:ring-3 focus-within:ring-primary/12",e),children:[o.jsx(Z,{className:"size-3.5 flex-none text-muted-foreground"}),o.jsx("input",{className:"w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground",...r})]})}function Q({options:e,value:r,onChange:t,className:a}){return o.jsx("div",{className:d("flex flex-wrap items-center gap-1.5",a),children:e.map(n=>{const s=n.id===r;return o.jsxs("button",{type:"button",onClick:()=>t(n.id),"data-active":s,className:d("rounded-xs border px-3 py-1.5 text-xs font-semibold transition-colors",s?"border-primary bg-primary text-primary-foreground":"border-border bg-card text-muted-foreground hover:text-foreground"),children:[n.label,n.count!==void 0?o.jsx("span",{className:"ml-1.5 opacity-70",children:n.count}):null]},n.id)})})}export{G as D,J as S,M as a,Q as b,I as c};
