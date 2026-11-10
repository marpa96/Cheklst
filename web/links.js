const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeURL(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
// Tokenize links before formatting, so URL punctuation and escaped HTML cannot become markup.
function tokens(text){
 const result=[];let plain='',i=0;const flush=()=>{if(plain){result.push({text:plain});plain='';}};
 while(i<text.length){
  if(text[i]==='`'){const end=text.indexOf('`',i+1);if(end>=0){flush();result.push({code:text.slice(i+1,end)});i=end+1;continue;}}
  if(text[i]==='['&&text[i-1]!=='!'){
   const labelEnd=text.indexOf('](',i+1);if(labelEnd>=0){let j=labelEnd+2,depth=1;for(;j<text.length;j++){if(text[j]==='(')depth++;if(text[j]===')'&&!--depth)break;if(text[j]!==')'&&depth===0)break;}
    if(depth===0){const url=safeURL(text.slice(labelEnd+2,j).trim());if(url){flush();result.push({label:text.slice(i+1,labelEnd),url});i=j+1;continue;}}
   }
  }
  const bare=text.slice(i).match(/^https?:\/\/[^\s<>]+/);if(bare){const raw=bare[0].replace(/[.,;!?]+$/,'');const url=safeURL(raw);if(url){flush();result.push({label:raw,url});i+=raw.length;continue;}}
  plain+=text[i++];
 }
 flush();return result;
}
const format=s=>escape(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
export function webLinks(text){return tokens(text).filter(t=>t.url);}
export function renderInline(text,{links=true}={}){return tokens(text).map(t=>t.code!==undefined?`<code>${escape(t.code)}</code>`:t.url?(links?`<a class="external-link" data-web-link href="${escape(t.url)}" target="_blank" rel="noopener noreferrer">${format(t.label)} ↗</a>`:format(t.label)):format(t.text)).join('');}
