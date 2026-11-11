// Repeat schedules, due dates and completion history for checklists.
//   c.schedule    {every:1-365, unit:'day'|'week'|'month'|'year'} | null (never) | undefined (not set)
//   c.nextDue     'YYYY-MM-DD' set by hand; cleared when the checklist is completed
//   c.completions ISO timestamps, oldest first (capped)
// Due dates are calendar days in local time.
export const UNITS=['day','week','month','year'];
export const MAX_COMPLETIONS=200;
const DAY=86_400_000;

export const dayKey=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
export const fromKey=k=>{const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d);};
const startOfDay=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x;};
const daysBetween=(a,b)=>Math.round((startOfDay(b)-startOfDay(a))/DAY);

export function validSchedule(s){
  return s===null||s===undefined||(typeof s==='object'&&Number.isInteger(s.every)&&s.every>=1&&s.every<=365&&UNITS.includes(s.unit));
}
export function addInterval(date,{every,unit}){
  const d=startOfDay(date);
  if(unit==='day')d.setDate(d.getDate()+every);
  else if(unit==='week')d.setDate(d.getDate()+7*every);
  else{
    // Months and years keep the day of month, clamped (Jan 31 + 1 month → Feb 28/29).
    const months=unit==='year'?12*every:every,day=d.getDate();
    d.setDate(1);d.setMonth(d.getMonth()+months);
    d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));
  }
  return d;
}
export function lastDone(c){const last=c.completions?.at(-1);return last?new Date(last):null;}
export function nextDue(c){
  if(c.nextDue)return fromKey(c.nextDue);
  if(!c.schedule)return null;
  const last=lastDone(c);
  return last?addInterval(last,c.schedule):null; // repeating but never done: no date yet ("not done yet")
}
export function describeSchedule(s){
  if(!s)return 'Doesn’t repeat';
  const names={day:['Daily','day'],week:['Weekly','week'],month:['Monthly','month'],year:['Yearly','year']}[s.unit];
  return s.every===1?names[0]:`Every ${s.every} ${names[1]}s`;
}
const fmtDate=(d,now)=>d.toLocaleDateString([], d.getFullYear()===now.getFullYear()?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'});
export function relativeDay(date,now=new Date()){
  const n=daysBetween(date,now);
  if(n===0)return 'today';if(n===1)return 'yesterday';if(n===-1)return 'tomorrow';
  if(n>1&&n<45)return `${n} days ago`;if(n<-1&&n>-45)return `in ${-n} days`;
  return fmtDate(date,now);
}
/** Due status for display, or null when the checklist has no schedule or due date. */
export function dueInfo(c,now=new Date()){
  if(!c.schedule&&!c.nextDue)return null;
  const due=nextDue(c);
  if(!due)return {due:null,days:0,tone:'today',label:'Not done yet'};
  const days=daysBetween(now,due);
  if(days<0)return {due,days,tone:'overdue',label:days===-1?'Overdue by a day':`Overdue ${-days} days`};
  if(days===0)return {due,days,tone:'today',label:'Due today'};
  if(days===1)return {due,days,tone:'soon',label:'Due tomorrow'};
  if(days<=7)return {due,days,tone:'soon',label:`Due in ${days} days`};
  return {due,days,tone:'later',label:`Due ${fmtDate(due,now)}`};
}
/** Checklists that need attention, most urgent first. Never-done repeating ones count as due. */
export function dueList(checklists,now=new Date(),{within=7}={}){
  return checklists.map(c=>({c,info:dueInfo(c,now)})).filter(x=>x.info&&(x.info.due===null||x.info.days<=within))
    .sort((a,b)=>(a.info.due?a.info.days:0)-(b.info.due?b.info.days:0)||a.c.title.localeCompare(b.c.title));
}

// A default schedule can live in the checklist's Markdown: <!-- repeat: every 2 weeks --> or <!-- repeat: monthly -->
export function parseRepeat(markdown){
  const m=String(markdown??'').match(/<!--\s*repeat:\s*([^>]*?)\s*-->/i);if(!m)return null;
  const text=m[1].toLowerCase();
  const word={daily:'day',weekly:'week',monthly:'month',yearly:'year',annually:'year'}[text];
  if(word)return {every:1,unit:word};
  const r=text.match(/^every\s+(\d+)?\s*(day|week|month|year)s?$/);
  if(!r)return null;
  const s={every:Number(r[1]||1),unit:r[2]};
  return validSchedule(s)?s:null;
}

// ---- state changes ----
export function recordCompletion(c,when=new Date()){
  c.completions=[...(c.completions||[]),new Date(when).toISOString()].slice(-MAX_COMPLETIONS);
  delete c.nextDue;
}
export function removeCompletion(c,iso){
  const i=(c.completions||[]).lastIndexOf(iso);if(i>=0)c.completions.splice(i,1);
}
export function setSchedule(c,schedule,nextDueKey){
  if(!validSchedule(schedule))throw new Error('Repeat must be 1–365 days, weeks, months or years.');
  c.schedule=schedule??null;
  if(nextDueKey){if(!/^\d{4}-\d{2}-\d{2}$/.test(nextDueKey)||isNaN(fromKey(nextDueKey)))throw new Error('Invalid due date.');c.nextDue=nextDueKey;}
  else delete c.nextDue;
}
