// JavaScript calculations: turns a checklist's ```js block into a standalone worker script.
// The app runs that script inside a sandboxed iframe (see jscalc.js), so the code has no access
// to the app, its data or the network, and is stopped if it runs too long. Tests run the same
// script directly with executeCalc().
//
// Inside a calculation you can use:
//   title("Water to carry")
//   const hours = input("Hours on the trail", 4)            number field
//   const hot = yesno("Hot weather?", false)                yes/no switch → true/false
//   const terrain = choice("Terrain", ["flat", "steep"])    buttons → the chosen item
//   const f = choice("Effort", {easy: 0.9, hard: 1.25}, "easy")   buttons → its value
//   show("Liters of water", liters, "liters")               result; the 3rd argument lets
//                                                            checklist text use {{liters}}
//   vars.name                                               values from other calculations
//   round(x, digits), clamp(x, lo, hi), interpolate(x, x1, y1, x2, y2), Math.*, console.log

// Builds the helpers a calculation sees. Self-contained: its source text goes into the worker.
function makeAPI(saved,vars){
  const inputs=[],outputs=[],logs=[],seen=new Set();let heading='';
  const has=k=>Object.prototype.hasOwnProperty.call(saved,k);
  const key=label=>{
    const k=String(label??'').trim();
    if(!k)throw new Error('Give each input a label, like input("Hours", 4).');
    if(seen.has(k))throw new Error(`Two inputs are both labeled “${k}”.`);
    seen.add(k);return k;
  };
  const input=(label,start=0)=>{
    const k=key(label),raw=String(has(k)?saved[k]:start??''),n=Number(raw.replace(/,/g,''));
    const error=!raw.trim()?'Enter a value.':Number.isFinite(n)?null:'Not a number.';
    inputs.push({type:'number',name:k,label:k,raw,value:error?null:n,error});
    return error?NaN:n;
  };
  const yesno=(label,start=false)=>{
    const k=key(label),raw=has(k)?saved[k]:(start?'yes':'no'),on=/^(yes|true|on|1)$/i.test(String(raw));
    inputs.push({type:'bool',name:k,label:k,raw:on?'yes':'no',value:on?1:0});
    return on;
  };
  const choice=(label,options,start)=>{
    const k=key(label);
    const list=Array.isArray(options)?options.map(o=>({label:String(o),value:o})):Object.entries(options??{}).map(([l,v])=>({label:l,value:v}));
    if(list.length<2)throw new Error(`choice("${k}", …) needs at least two options.`);
    const want=String(has(k)?saved[k]:start??list[0].label),picked=list.find(o=>o.label===want)??list[0];
    inputs.push({type:'choice',name:k,label:k,raw:picked.label,options:list.map(o=>({label:o.label})),value:typeof picked.value==='number'?picked.value:null});
    return picked.value;
  };
  const show=(label,value,name)=>{
    if(name!==undefined&&name!==null&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name)))throw new Error(`show(…, “${name}”): the name must be one word, like liters.`);
    let v=value;
    if(typeof v==='boolean')v=v?'Yes':'No';
    else if(typeof v==='number'&&!Number.isFinite(v))v=null;
    else if(typeof v!=='number')v=v===undefined||v===null?null:String(v);
    outputs.push({label:String(label),value:v,name:name??null});
  };
  const title=t=>{heading=String(t);};
  const round=(x,d=0)=>{const f=10**d;return Math.round((x+Number.EPSILON)*f)/f;};
  const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
  const interpolate=(x,x1,y1,x2,y2)=>{if(x1===x2)return y1;const t=Math.min(1,Math.max(0,(x-x1)/(x2-x1)));return y1+t*(y2-y1);};
  const log=(...a)=>{if(logs.length<50)logs.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,500));};
  const api={input,yesno,choice,show,title,vars:Object.freeze({...vars}),round,clamp,interpolate,console:{log,info:log,warn:log,error:log}};
  // The error's line in the user's code: the first stack frame inside the generated script.
  const finish=(err,offset)=>{
    if(!err)return {ok:true,title:heading,inputs,outputs,logs};
    const m=String(err?.stack??'').match(/(?:<anonymous>|blob:[^\s)]*?):(\d+):\d+/);
    const line=m&&Number(m[1])-offset>0?Number(m[1])-offset:null;
    const message=`${err?.name&&err.name!=='Error'?err.name+': ':''}${err?.message??String(err)}`;
    return {ok:false,error:line?`Line ${line}: ${message}`:message,title:heading,inputs,outputs,logs};
  };
  return {api,finish};
}
const PARAMS=['input','yesno','choice','show','title','vars','round','clamp','interpolate','console'];

/** The complete worker script for one calculation. The user's code starts on line `offset`+1. */
export function workerSource(code,{saved={},vars={},lineShift=0}={}){
  const head=[
    '"use strict";',
    `const makeAPI=${makeAPI.toString()};`,
    `const {api,finish}=makeAPI(${JSON.stringify(saved)},${JSON.stringify(vars)});`,
    'let failure=null;',
    `try{(function(${PARAMS.join(',')}){"use strict";`,
  ].join('\n');
  const offset=head.split('\n').length;
  return {source:`${head}\n${code}\n})(${PARAMS.map(p=>'api.'+p).join(',')});}catch(e){failure=e;}\npostMessage(finish(failure,${offset+lineShift}));`,offset};
}

/** Run a calculation directly (tests, or anywhere a sandbox isn't needed). */
export function executeCalc(code,options={}){
  // new Function adds its own header lines; measure them so line numbers still match.
  let lineShift=0;try{new Function('x','throw new Error()')();}catch(e){const m=String(e.stack).match(/<anonymous>:(\d+):\d+/);lineShift=m?Number(m[1])-1:0;}
  const {source,offset}=workerSource(code,{...options,lineShift});
  let result=null;
  try{new Function('postMessage',source)(r=>{result=r;});}
  catch(e){
    // A syntax error stops the whole script from compiling.
    return {ok:false,error:`${e.name}: ${e.message}`,title:'',inputs:[],outputs:[],logs:[],offset};
  }
  return result;
}

export const JS_TEMPLATE=`title("Water to carry");
const hours = input("Hours on the trail", 4);
const temp = input("Temperature (°F)", 70);
const strenuous = yesno("Strenuous terrain?", false);

// 0.5 L per hour, up to 1 L per hour in the heat or on hard terrain
const rate = temp >= 85 || strenuous ? 1 : 0.5;
show("Liters of water", round(hours * rate * 1.2, 1), "liters");`;
