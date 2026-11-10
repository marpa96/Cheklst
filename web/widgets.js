// "Generative" item widgets: Cheklst reads what an item says and picks a control for it.
//   "Let the engine idle 2 min"  → a countdown timer
//   "3 pairs of socks" / "Water bottle ×2" → a tap counter that checks the item when full
// Pure functions only, so they're easy to test.

const UNITS={h:3600,hr:3600,hrs:3600,hour:3600,hours:3600,min:60,mins:60,minute:60,minutes:60,sec:1,secs:1,second:1,seconds:1};
// "10 min", "1.5 hours", "90 seconds", and compact "30m", "1h", "45s", "1h 30m".
const DURATION=/(?<![\w.])(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?:\s*(\d+)\s*(minutes?|mins?|m)\b)?/i;

export function detectTimer(text){
  const m=String(text).match(DURATION);if(!m)return null;
  let unit=m[2].toLowerCase();
  // A bare "m"/"h"/"s" only counts when attached to the number ("30m"), so "100 m" (meters) is not a timer.
  if(unit.length===1&&/\s/.test(m[0].slice(m[1].length,m[1].length+1)))return null;
  if(unit.length===1)unit={h:'h',m:'min',s:'sec'}[unit];
  let seconds=Number(m[1])*UNITS[unit];
  if(m[3])seconds+=Number(m[3])*60;
  seconds=Math.round(seconds);
  if(seconds<5||seconds>24*3600)return null;
  return {seconds,label:m[0].trim()};
}

// "3 pairs of socks", "2x chargers", "12 tent stakes", "Socks ×3", "Snacks x 4".
const LEADING=/^\s*(\d{1,3})\s*(?:x|×)?\s+(?=[A-Za-zÀ-ɏ])/;
const TRAILING=/(?:^|\s)(?:x|×)\s?(\d{1,3})\s*$/i;
export function detectCount(text){
  const s=String(text),m=s.match(LEADING)||s.match(TRAILING);if(!m)return null;
  const target=Number(m[1]);
  if(target<2||target>99)return null;
  if(detectTimer(s)?.label.startsWith(m[1]))return null; // "10 minutes …" is a timer, not 10 things
  return {target};
}

export function detectWidgets(text){
  const timer=detectTimer(text),count=detectCount(text);
  return {timer,count};
}

export function clock(seconds){
  seconds=Math.max(0,Math.ceil(seconds));
  const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60,pad=n=>String(n).padStart(2,'0');
  return h?`${h}:${pad(m)}:${pad(s)}`:`${m}:${pad(s)}`;
}

// Step for a calculation input's −/+ buttons, from its current value.
export function stepFor(raw){
  const text=String(raw??'').trim(),decimals=(text.split('.')[1]||'').length;
  if(decimals)return Number((10**-Math.min(decimals,4)).toFixed(4));
  const v=Math.abs(Number(text)||0);
  return v>=5000?100:v>=500?10:1;
}
export function stepValue(raw,direction,step=stepFor(raw)){
  const v=Number(String(raw).replace(/,/g,''))||0,decimals=(String(step).split('.')[1]||'').length;
  return (Math.round((v+direction*step)/step)*step).toFixed(decimals);
}
