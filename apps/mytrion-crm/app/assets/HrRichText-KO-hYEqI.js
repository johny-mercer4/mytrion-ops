import{E as y,r as f,j as t,b4 as R}from"./index-CEAMv7E2.js";import{e as S}from"./MytrionShell-DJx_XABC.js";import{L as _}from"./send-69LMNRW0.js";import{L as C}from"./rotate-ccw-CplSdW8Z.js";import{P as E}from"./pencil-BbRIA9Fe.js";/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B=[["path",{d:"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",key:"mg9rjx"}]],P=y("bold",B);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A=[["line",{x1:"19",x2:"10",y1:"4",y2:"4",key:"15jd3p"}],["line",{x1:"14",x2:"5",y1:"20",y2:"20",key:"bu0au3"}],["line",{x1:"15",x2:"9",y1:"4",y2:"20",key:"uljnxc"}]],F=y("italic",A);/**
 * @license lucide-react v1.23.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const H=[["path",{d:"M11 5h10",key:"1cz7ny"}],["path",{d:"M11 12h10",key:"1438ji"}],["path",{d:"M11 19h10",key:"11t30w"}],["path",{d:"M4 4h1v5",key:"10yrso"}],["path",{d:"M4 9h2",key:"r1h2o0"}],["path",{d:"M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02",key:"xtkcd5"}]],O=y("list-ordered",H),q={before:"**",after:"**"},v={before:"_",after:"_"},T={before:"[",after:"](https://)"};function Q({value:r,onChange:x,id:L,placeholder:w,disabled:c,rows:z=6}){const[s,I]=f.useState(!1),l=f.useRef(null),m=f.useRef(null),p=e=>{const n=e.currentTarget;m.current={start:n.selectionStart,end:n.selectionEnd}},j=e=>document.activeElement===e?{start:e.selectionStart,end:e.selectionEnd}:m.current??{start:r.length,end:r.length},u=e=>{const n=l.current;if(!n)return;const{start:o,end:d}=j(n),h=r.slice(o,d),i=`${r.slice(0,o)}${e.before}${h}${e.after}${r.slice(d)}`;x(i);const a=o+e.before.length;requestAnimationFrame(()=>{n.focus(),n.setSelectionRange(a,a+h.length)})},k=({prefix:e,ordered:n})=>{const o=l.current;if(!o)return;const{start:d,end:h}=j(o),i=r.lastIndexOf(`
`,d-1)+1,a=r.indexOf(`
`,h),g=a===-1?r.length:a,N=(r.slice(i,g)||"").split(`
`).map((b,M)=>{const $=n?`${M+1}. `:e;return b.startsWith($)?b:`${$}${b}`}).join(`
`);x(`${r.slice(0,i)}${N}${r.slice(g)}`),requestAnimationFrame(()=>{o.focus(),o.setSelectionRange(i,i+N.length)})};return t.jsxs("div",{className:"hr-rt","data-preview":s?"on":void 0,children:[t.jsxs("div",{className:"hr-rt-bar",children:[t.jsxs("div",{className:"hr-rt-tools",role:"group","aria-label":"Formatting",children:[t.jsx("button",{type:"button",className:"hr-rt-icon-btn","aria-label":"Bold",disabled:c||s,onClick:()=>u(q),children:t.jsx(P,{size:14})}),t.jsx("button",{type:"button",className:"hr-rt-icon-btn","aria-label":"Italic",disabled:c||s,onClick:()=>u(v),children:t.jsx(F,{size:14})}),t.jsx("button",{type:"button",className:"hr-rt-icon-btn","aria-label":"Bulleted list",disabled:c||s,onClick:()=>k({prefix:"- "}),children:t.jsx(_,{size:14})}),t.jsx("button",{type:"button",className:"hr-rt-icon-btn","aria-label":"Numbered list",disabled:c||s,onClick:()=>k({prefix:"1. ",ordered:!0}),children:t.jsx(O,{size:14})}),t.jsx("button",{type:"button",className:"hr-rt-icon-btn","aria-label":"Link",disabled:c||s,onClick:()=>u(T),children:t.jsx(C,{size:14})})]}),t.jsxs("button",{type:"button",className:"hr-rt-toggle","aria-pressed":s,onClick:()=>{const e=s;I(!s),e&&requestAnimationFrame(()=>{const n=l.current,o=m.current;!n||!o||(n.focus(),n.setSelectionRange(o.start,o.end))})},children:[s?t.jsx(E,{size:13}):t.jsx(R,{size:13}),s?"Write":"Preview"]})]}),s?t.jsx("div",{className:"hr-rt-preview",children:r.trim()?t.jsx(S,{text:r}):t.jsx("p",{className:"hr-rt-empty",children:"Nothing to preview yet."})}):t.jsx("textarea",{id:L,ref:l,className:"hr-rt-input",value:r,rows:z,disabled:c,placeholder:w,onChange:e=>x(e.target.value),onSelect:p,onKeyUp:p,onBlur:p,spellCheck:!0})]})}export{Q as H};
