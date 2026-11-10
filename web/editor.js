// Visual editor model: a checklist is a list of rows that round-trips to Markdown.
// Anything the visual editor doesn't model (tables, code, plain text) stays as an
// untouched "text" row, so switching between visual and Markdown modes loses nothing.
import {parse} from './core.js';

export const ROW_TYPES=[['item','Checkbox item'],['heading','Section heading'],['note','Note'],['calc','Calculation'],['text','Plain text / Markdown']];
export const CALLOUTS=['','tip','important','warning','caution'];

export function markdownToRows(md){
  const lines=md.split('\n'),rows=[];
  for(const b of parse(md)){
    if(b.kind==='task')rows.push({type:'item',text:b.text,depth:Math.min(4,Math.floor(b.depth/2))});
    else if(b.kind==='heading')rows.push({type:'heading',text:b.text});
    else if(b.kind==='note')rows.push(b.callout?{type:'note',text:b.body,callout:b.callout==='note'?'':b.callout}:{type:'note',text:b.text,callout:''});
    else if(b.kind==='calc')rows.push({type:'calc',text:b.body});
    else rows.push({type:'text',text:lines.slice(b.line,b.end).join('\n')});
  }
  return rows;
}

export function rowsToMarkdown(rows){
  const out=[];let previous=null;
  for(const row of rows){
    const text=String(row.text??'').replace(/\r/g,'');
    if(row.type!=='text'&&!text.trim()&&row.type!=='calc')continue;
    // Consecutive items form one list; everything else is separated by a blank line.
    if(out.length&&!(previous==='item'&&row.type==='item'))out.push('');
    if(row.type==='item')out.push(`${'  '.repeat(row.depth||0)}- [ ] ${text.replace(/\n+/g,' ').trim()}`);
    else if(row.type==='heading')out.push(`## ${text.replace(/\n+/g,' ').trim()}`);
    else if(row.type==='note'){
      const body=text.trim().split('\n');
      if(row.callout)out.push(`> [!${row.callout.toUpperCase()}]`);
      out.push(...body.map(l=>l?`> ${l}`:'>'));
    }
    else if(row.type==='calc')out.push('```calc',...text.trim().split('\n'),'```');
    else out.push(text.replace(/\n+$/,''));
    previous=row.type;
  }
  return out.join('\n')+'\n';
}

export function newRow(type){return type==='item'?{type,text:'',depth:0}:type==='note'?{type,text:'',callout:''}:{type,text:''};}
export function moveRow(rows,index,direction){
  const j=index+direction;if(j<0||j>=rows.length)return rows;
  const next=[...rows];[next[index],next[j]]=[next[j],next[index]];return next;
}
