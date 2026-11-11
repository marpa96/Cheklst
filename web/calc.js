// Calculations inside checklists. A ```calc block declares inputs and formulas:
//
//   title Trip fuel cost
//   input distance = 120 | Distance (mi)
//   input mpg = 30 | Fuel economy (mpg)
//   let gallons = distance / mpg          (hidden intermediate)
//   show cost = round(gallons * 3.5, 2) | Trip cost ($)
//
// All calc blocks in a checklist share one set of names, and any checklist text can
// show a result with {{cost}}. Formulas run in a small arithmetic evaluator — never
// eval() — so a checklist cannot execute code. (Running code is a later, separate feature.)

const rad=d=>d*Math.PI/180;
const FUNCTIONS={
  min:(...a)=>Math.min(...a),max:(...a)=>Math.max(...a),abs:Math.abs,sqrt:Math.sqrt,
  floor:Math.floor,ceil:Math.ceil,pow:Math.pow,trunc:Math.trunc,sign:Math.sign,
  round:(x,d=0)=>{const f=10**d;return Math.round((x+Number.EPSILON)*f)/f;},
  if:(c,a,b)=>c?a:b,
  clamp:(x,lo,hi)=>Math.min(hi,Math.max(lo,x)),
  // Straight line from (x1,y1) to (x2,y2), held flat outside that range.
  interpolate:(x,x1,y1,x2,y2)=>{if(x1===x2)return y1;const t=Math.min(1,Math.max(0,(x-x1)/(x2-x1)));return y1+t*(y2-y1);},
  sum:(...a)=>a.reduce((s,x)=>s+x,0),avg:(...a)=>a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN,
  log:Math.log10,ln:Math.log,exp:Math.exp,
  // Trigonometry in degrees (headings, slopes, wind angles).
  sin:d=>Math.sin(rad(d)),cos:d=>Math.cos(rad(d)),tan:d=>Math.tan(rad(d)),
  asin:x=>Math.asin(x)*180/Math.PI,acos:x=>Math.acos(x)*180/Math.PI,atan:x=>Math.atan(x)*180/Math.PI,
};
const CONSTANTS={pi:Math.PI,e:Math.E};
// Words usable in formulas: and / or / not, and yes / no / true / false as 1 and 0.
const WORD_OPS={and:'&&',or:'||',not:'!'},WORD_VALUES={yes:1,no:0,true:1,false:0,on:1,off:0};
const NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED=new Set([...Object.keys(FUNCTIONS),...Object.keys(CONSTANTS),...Object.keys(WORD_OPS),...Object.keys(WORD_VALUES)]);
export const FUNCTION_NAMES=Object.keys(FUNCTIONS);

function tokenize(src){
  const tokens=[];let i=0;
  while(i<src.length){
    const ch=src[i];
    if(/\s/.test(ch)){i++;continue;}
    const num=src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if(num){tokens.push({t:'num',v:Number(num[0])});i+=num[0].length;continue;}
    const id=src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if(id){
      const w=id[0].toLowerCase();
      if(Object.hasOwn(WORD_OPS,w))tokens.push({t:'op',v:WORD_OPS[w]});
      else if(Object.hasOwn(WORD_VALUES,w))tokens.push({t:'num',v:WORD_VALUES[w]});
      else tokens.push({t:'id',v:id[0]});
      i+=id[0].length;continue;
    }
    const op=src.slice(i).match(/^(<=|>=|==|!=|&&|\|\||[-+*/%^(),<>!])/);
    if(op){tokens.push({t:'op',v:op[0]});i+=op[0].length;continue;}
    throw new Error(`Unexpected “${ch}” in formula.`);
  }
  return tokens;
}

// Recursive descent: or > and > comparison > additive > multiplicative > power > unary > primary.
export function evaluate(expression,vars={}){
  const tokens=tokenize(String(expression));let pos=0;
  const peek=()=>tokens[pos],next=()=>tokens[pos++];
  const isOp=v=>peek()?.t==='op'&&peek().v===v;
  const expect=v=>{if(!isOp(v))throw new Error(`Expected “${v}” in formula.`);pos++;};
  const binary=(sub,ops,apply)=>()=>{let left=sub();while(peek()?.t==='op'&&ops.includes(peek().v)){const op=next().v;left=apply(op,left,sub());}return left;};
  const primary=()=>{
    const tok=next();
    if(!tok)throw new Error('Formula ended early.');
    if(tok.t==='num')return tok.v;
    if(tok.t==='op'&&tok.v==='('){const v=or();expect(')');return v;}
    if(tok.t==='id'){
      if(isOp('(')){
        const fn=FUNCTIONS[tok.v];if(!fn)throw new Error(`Unknown function “${tok.v}”.`);
        pos++;const args=[];
        if(!isOp(')')){args.push(or());while(isOp(',')){pos++;args.push(or());}}
        expect(')');return fn(...args);
      }
      if(Object.hasOwn(vars,tok.v))return vars[tok.v];
      if(Object.hasOwn(CONSTANTS,tok.v))return CONSTANTS[tok.v];
      throw new Error(`“${tok.v}” has no value yet.`);
    }
    throw new Error(`Unexpected “${tok.v}” in formula.`);
  };
  const unary=()=>{if(isOp('-')){pos++;return -unary();}if(isOp('+')){pos++;return unary();}if(isOp('!')){pos++;return unary()?0:1;}return power();};
  const power=()=>{const base=primary();if(isOp('^')){pos++;return base**unary();}return base;};
  const mul=binary(unary,['*','/','%'],(op,a,b)=>op==='*'?a*b:op==='/'?a/b:a%b);
  const add=binary(mul,['+','-'],(op,a,b)=>op==='+'?a+b:a-b);
  const cmp=binary(add,['<','>','<=','>=','==','!='],(op,a,b)=>Number(op==='<'?a<b:op==='>'?a>b:op==='<='?a<=b:op==='>='?a>=b:op==='=='?a===b:a!==b));
  const and=binary(cmp,['&&'],(op,a,b)=>Number(a&&b));
  const or=binary(and,['||'],(op,a,b)=>Number(a||b));
  const value=or();
  if(pos<tokens.length)throw new Error(`Unexpected “${peek().v}” in formula.`);
  if(typeof value!=='number'||Number.isNaN(value))throw new Error('Result is not a number.');
  if(!Number.isFinite(value))throw new Error('Result is infinite (division by zero?).');
  return value;
}

// Parse one calc block body into a definition. Throws with a line number on bad syntax.
//   input name = 10 | Label                          number field
//   input name = no | Label                          yes/no switch (1 or 0 in formulas)
//   input name = moderate | Label | flat: 1, moderate: 1.1, steep: 1.25   pick one (its number)
//   let name = formula                               hidden working value
//   show name = formula | Label                      result on the card
//   show name | Label                                show a value defined earlier
// A line that doesn't start with title/input/let/show continues the formula above it.
const KEYWORD=/^(title|input|let|show)\b/i;
const SEPARATOR=/(?<!\|)\|(?!\|)/;   // a single | (so || stays the "or" operator)
const BOOL=/^(yes|no|true|false|on|off)$/i;
export const truthy=raw=>/^(yes|true|on|1)$/i.test(String(raw??'').trim());
function parseOptions(text,where){
  const parts=text.split(',').map(x=>x.trim()).filter(Boolean);
  if(parts.length<2)throw new Error(where+'list at least two choices, like “flat: 1, steep: 1.25”.');
  return parts.map((part,i)=>{
    const m=part.match(/^(.+?)\s*[:=]\s*(-?[\d.]+)$/);
    const label=(m?m[1]:part).trim(),value=m?Number(m[2]):i+1;
    if(!label||!Number.isFinite(value))throw new Error(where+`choice “${part}” should look like “name: number”.`);
    return {label,value};
  });
}
export function parseCalc(body){
  const def={title:'',lines:[]},names=new Map(),logical=[];
  body.split('\n').forEach((raw,index)=>{
    const line=raw.trim();if(!line||line.startsWith('//'))return;
    if(!KEYWORD.test(line)&&logical.length&&!/^title\b/i.test(logical.at(-1).text)){logical.at(-1).text+=' '+line;return;}
    logical.push({text:line,index});
  });
  for(const {text:line,index} of logical){
    const where=`Calculation line ${index+1}: `;
    const title=line.match(/^title\s+(.+)$/i);if(title){def.title=title[1].trim();continue;}
    const [head,label='',options]=line.split(SEPARATOR).map(x=>x.trim());
    const m=head.match(/^(input|let|show)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([\s\S]*))?$/i);
    if(!m)throw new Error(where+'use “input name = value | Label”, “let name = formula” or “show name = formula | Label”.');
    const kind=m[1].toLowerCase(),name=m[2],expr=(m[3]??'').trim(),reference=kind==='show'&&m[3]===undefined;
    if(RESERVED.has(name.toLowerCase()))throw new Error(where+`“${name}” is a built-in name; pick another.`);
    // A "show" may reuse a "let" name (let hours = …, then show hours = round(hours, 1)).
    if(!reference){
      if(names.has(name)&&!(kind==='show'&&names.get(name)==='let'))throw new Error(where+`“${name}” is defined twice.`);
      names.set(name,kind);
    }
    if(kind!=='input'&&!expr&&!reference)throw new Error(where+`give “${name}” a formula.`);
    const entry={kind,name,expr,label:label||name,reference};
    if(kind==='input'){
      if(options!==undefined){
        entry.type='choice';entry.options=parseOptions(options,where);
        if(expr&&!entry.options.some(o=>o.label.toLowerCase()===expr.toLowerCase()))throw new Error(where+`the starting choice “${expr}” isn’t one of the options.`);
      }else if(BOOL.test(expr))entry.type='bool';
      else{entry.type='number';if(expr!==''&&!Number.isFinite(Number(expr.replace(/,/g,''))))throw new Error(where+'an input starts with a number, yes/no, or one of its choices.');}
    }else if(options!==undefined)throw new Error(where+'only inputs can have a list of choices.');
    def.lines.push(entry);
  }
  return def;
}

export function number(value){
  const text=String(value??'').trim().replace(/,/g,'');
  if(!text)return null;
  const n=Number(text);return Number.isFinite(n)?n:NaN;
}

// Evaluate every calc block in a document, in order, against the user's saved inputs.
// Returns per-block results (keyed by block line) and the shared variables.
export function runCalcs(blocks,saved={}){
  const vars={},results={},failed={};
  for(const b of blocks){
    if(b.kind!=='calc')continue;
    const result={title:'',inputs:[],outputs:[],problems:[],error:null};results[b.line]=result;
    let def;try{def=parseCalc(b.body);}catch(e){result.error=e.message;continue;}
    result.title=def.title;
    for(const l of def.lines){
      if(l.kind==='input'){
        const raw=Object.hasOwn(saved,l.name)?saved[l.name]:l.expr;
        let value,error=null,shown=String(raw??'');
        if(l.type==='bool'){value=truthy(raw)?1:0;shown=value?'yes':'no';}
        else if(l.type==='choice'){
          const option=l.options.find(o=>o.label.toLowerCase()===String(raw??'').trim().toLowerCase())??l.options.find(o=>o.label.toLowerCase()===l.expr.toLowerCase())??l.options[0];
          value=option.value;shown=option.label;
        }else{value=number(raw);error=value===null?'Enter a value.':Number.isNaN(value)?'Not a number.':null;}
        result.inputs.push({name:l.name,label:l.label,type:l.type,options:l.options,raw:shown,value,error});
        if(Number.isFinite(value))vars[l.name]=value;else failed[l.name]=error;
        continue;
      }
      let value=null,error=null;
      try{
        if(l.reference){if(!Object.hasOwn(vars,l.name))throw new Error(`“${l.name}” has no value yet.`);value=vars[l.name];}
        else{value=evaluate(l.expr,vars);vars[l.name]=value;}
      }catch(e){
        // Point at the real cause when a formula depends on a value that failed earlier.
        const missing=e.message.match(/^“(.+)” has no value yet\.$/)?.[1];
        error=missing&&failed[missing]?`needs “${missing}”, which couldn’t be calculated: ${failed[missing]}`:e.message;
        if(!l.reference)failed[l.name]=error;
      }
      if(l.kind==='show')result.outputs.push({name:l.name,label:l.label,value,error});
      else if(error)result.problems.push({name:l.name,error});
    }
  }
  return {vars,results};
}

export function format(value){
  if(typeof value!=='number'||!Number.isFinite(value))return '—';
  return value.toLocaleString(undefined,{maximumFractionDigits:4});
}
// Replace {{name}} in text with a computed value (left visible as “name?” when missing).
export function substitute(text,vars){
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,(_,name)=>!Object.hasOwn(vars,name)?`${name}?`:typeof vars[name]==='string'?vars[name]:format(vars[name]));
}
export const CALC_TEMPLATE='title Trip fuel cost\ninput distance = 120 | Distance (mi)\ninput mpg = 30 | Fuel economy (mpg)\ninput price = 3.50 | Gas price ($/gal)\nlet gallons = distance / mpg\nshow cost = round(gallons * price, 2) | Trip cost ($)';
