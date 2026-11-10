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

const FUNCTIONS={
  min:(...a)=>Math.min(...a),max:(...a)=>Math.max(...a),abs:Math.abs,sqrt:Math.sqrt,
  floor:Math.floor,ceil:Math.ceil,pow:Math.pow,
  round:(x,d=0)=>{const f=10**d;return Math.round((x+Number.EPSILON)*f)/f;},
  if:(c,a,b)=>c?a:b,
};
const CONSTANTS={pi:Math.PI,e:Math.E};
const NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED=new Set([...Object.keys(FUNCTIONS),...Object.keys(CONSTANTS)]);

function tokenize(src){
  const tokens=[];let i=0;
  while(i<src.length){
    const ch=src[i];
    if(/\s/.test(ch)){i++;continue;}
    const num=src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if(num){tokens.push({t:'num',v:Number(num[0])});i+=num[0].length;continue;}
    const id=src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if(id){tokens.push({t:'id',v:id[0]});i+=id[0].length;continue;}
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
export function parseCalc(body){
  const def={title:'',lines:[]},names=new Set();
  body.split('\n').forEach((raw,index)=>{
    const line=raw.trim();if(!line||line.startsWith('//'))return;
    const where=`Calculation line ${index+1}: `;
    const title=line.match(/^title\s+(.+)$/i);if(title){def.title=title[1].trim();return;}
    const m=line.match(/^(input|let|show)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^|]*?)\s*(?:\|\s*(.*))?$/i);
    if(!m)throw new Error(where+'use “input name = value | Label”, “let name = formula” or “show name = formula | Label”.');
    const [,kind,name,expr,label]=m;
    if(RESERVED.has(name))throw new Error(where+`“${name}” is a built-in name.`);
    if(names.has(name))throw new Error(where+`“${name}” is defined twice.`);
    names.add(name);
    if(kind.toLowerCase()==='input'&&expr!==''&&!Number.isFinite(Number(expr)))throw new Error(where+'an input’s starting value must be a number (or left blank).');
    if(kind.toLowerCase()!=='input'&&!expr)throw new Error(where+`give “${name}” a formula.`);
    def.lines.push({kind:kind.toLowerCase(),name,expr,label:(label||'').trim()||name});
  });
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
  const vars={},results={};
  for(const b of blocks){
    if(b.kind!=='calc')continue;
    const result={title:'',inputs:[],outputs:[],error:null};results[b.line]=result;
    let def;try{def=parseCalc(b.body);}catch(e){result.error=e.message;continue;}
    result.title=def.title;
    for(const l of def.lines){
      if(l.kind==='input'){
        const raw=Object.hasOwn(saved,l.name)?saved[l.name]:l.expr;
        const value=number(raw);
        result.inputs.push({name:l.name,label:l.label,raw:String(raw??''),value,error:value===null?'Enter a value.':Number.isNaN(value)?'Not a number.':null});
        if(Number.isFinite(value))vars[l.name]=value;
        continue;
      }
      let value=null,error=null;
      try{value=evaluate(l.expr,vars);vars[l.name]=value;}catch(e){error=e.message;}
      if(l.kind==='show')result.outputs.push({name:l.name,label:l.label,value,error});
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
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,(_,name)=>Object.hasOwn(vars,name)?format(vars[name]):`${name}?`);
}
export const CALC_TEMPLATE='title Trip fuel cost\ninput distance = 120 | Distance (mi)\ninput mpg = 30 | Fuel economy (mpg)\ninput price = 3.50 | Gas price ($/gal)\nlet gallons = distance / mpg\nshow cost = round(gallons * price, 2) | Trip cost ($)';
