import{a as D,aj as w}from"./index-Bnv0J0y9.js";var V={exports:{}},h={},G={exports:{}},C={};/**
 * @license React
 * use-sync-external-store-shim.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */(function(){function p(e,r){return e===r&&(e!==0||1/e===1/r)||e!==e&&r!==r}function i(e,r){o||a.startTransition===void 0||(o=!0,console.error("You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."));var t=r();if(!s){var u=r();E(t,u)||(console.error("The result of getSnapshot should be cached to avoid an infinite loop"),s=!0)}u=T({inst:{value:t,getSnapshot:r}});var n=u[0].inst,l=u[1];return m(function(){n.value=t,n.getSnapshot=r,c(n)&&l({inst:n})},[e,t,r]),A(function(){return c(n)&&l({inst:n}),e(function(){c(n)&&l({inst:n})})},[e]),_(t),t}function c(e){var r=e.getSnapshot;e=e.value;try{var t=r();return!E(e,t)}catch{return!0}}function v(e,r){return r()}typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart=="function"&&__REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());var a=D,E=typeof Object.is=="function"?Object.is:p,T=a.useState,A=a.useEffect,m=a.useLayoutEffect,_=a.useDebugValue,o=!1,s=!1,d=typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"?v:i;C.useSyncExternalStore=a.useSyncExternalStore!==void 0?a.useSyncExternalStore:d,typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop=="function"&&__REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error())})();G.exports=C;var g=G.exports;/**
 * @license React
 * use-sync-external-store-shim/with-selector.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */(function(){function p(_,o){return _===o&&(_!==0||1/_===1/o)||_!==_&&o!==o}typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart=="function"&&__REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());var i=D,c=g,v=typeof Object.is=="function"?Object.is:p,a=c.useSyncExternalStore,E=i.useRef,T=i.useEffect,A=i.useMemo,m=i.useDebugValue;h.useSyncExternalStoreWithSelector=function(_,o,s,d,e){var r=E(null);if(r.current===null){var t={hasValue:!1,value:null};r.current=t}else t=r.current;r=A(function(){function n(f){if(!l){if(l=!0,S=f,f=d(f),e!==void 0&&t.hasValue){var O=t.value;if(e(O,f))return L=O}return L=f}if(O=L,v(S,f))return O;var R=d(f);return e!==void 0&&e(O,R)?(S=f,O):(S=f,L=R)}var l=!1,S,L,y=s===void 0?null:s;return[function(){return n(o())},y===null?void 0:function(){return n(y())}]},[o,s,d,e]);var u=a(_,r[0],r[1]);return T(function(){t.hasValue=!0,t.value=u},[u]),m(u),u},typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop=="function"&&__REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error())})();V.exports=h;var B=V.exports;const K=w(B);export{g as s,K as u,B as w};
