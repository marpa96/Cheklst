// Time-adaptive color: three hues drift through the day (night indigo → dawn coral →
// daytime sky → golden hour → dusk violet). They're written to CSS variables that the
// animated background, accents and gradients are built from.
const STOPS=[
  [0,[262,292,218]],     // night
  [4.5,[270,320,235]],   // before dawn
  [6.5,[18,42,335]],     // dawn
  [9,[205,168,250]],     // morning
  [13,[218,188,155]],    // midday
  [17,[38,16,320]],      // golden hour
  [19.5,[300,258,335]],  // dusk
  [21.5,[262,292,218]],  // night
  [24,[262,292,218]],
];
const mixHue=(a,b,t)=>{const d=((b-a+540)%360)-180;return (a+d*t+360)%360;};

export function palette(date=new Date()){
  const h=date.getHours()+date.getMinutes()/60;
  const i=STOPS.findIndex(([at])=>at>h)-1,[a,ha]=STOPS[Math.max(0,i)],[b,hb]=STOPS[Math.max(1,i+1)];
  const t=(h-a)/(b-a||1);
  return ha.map((x,k)=>Math.round(mixHue(x,hb[k],t)));
}
export function phase(date=new Date()){
  const h=date.getHours();
  if(h<5)return {name:'night',greeting:'Late night',icon:'🌙'};
  if(h<12)return {name:'morning',greeting:'Good morning',icon:h<8?'🌅':'☀️'};
  if(h<17)return {name:'afternoon',greeting:'Good afternoon',icon:'🌤️'};
  if(h<21)return {name:'evening',greeting:'Good evening',icon:'🌇'};
  return {name:'night',greeting:'Good night',icon:'🌙'};
}
// A stable hue for a category name, so each category keeps its own color.
export function hueFor(name){
  let x=2166136261;for(const ch of String(name).toLowerCase()){x^=ch.codePointAt(0);x=Math.imul(x,16777619);}
  return (x>>>0)%360;
}

const AMBIENT_KEY='cheklst.ambient.v1',FIXED=[262,300,205];
export function ambientEnabled(){try{return localStorage.getItem(AMBIENT_KEY)!=='off';}catch{return true;}}
let apply=()=>{};
export function setAmbientEnabled(on){try{localStorage.setItem(AMBIENT_KEY,on?'on':'off');}catch{}apply();}
export function startAmbient(root=document.documentElement){
  apply=()=>{const [a,b,c]=ambientEnabled()?palette():FIXED;root.style.setProperty('--h1',a);root.style.setProperty('--h2',b);root.style.setProperty('--h3',c);root.dataset.phase=phase().name;};
  apply();setInterval(apply,60_000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply();});
}
