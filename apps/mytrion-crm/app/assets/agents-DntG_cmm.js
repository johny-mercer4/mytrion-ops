import{r as t}from"./index-D9e_DKnP.js";async function n(a=!1){return(await t("GET","/admin/agents",{impersonate:!1,...a?{query:{all:"1"}}:{}})).agents??[]}export{n as l};
