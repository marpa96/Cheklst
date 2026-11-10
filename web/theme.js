// Runs before styles load so a dark-mode launch never flashes light.
(() => {
  const key='cheklst.theme.v1',choices=['auto','light','dark'];
  let preference='auto';
  try { preference=localStorage.getItem(key)||'auto'; } catch {}
  if(!choices.includes(preference))preference='auto';
  const media=matchMedia('(prefers-color-scheme: dark)');
  function apply(){
    const dark=preference==='dark'||(preference==='auto'&&media.matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#14161d':'#f5f6fa');
  }
  window.cheklstTheme={get preference(){return preference;},set(value){
    if(!choices.includes(value))return;
    localStorage.setItem(key,value);preference=value;apply();
  }};
  media.addEventListener?.('change',apply);
  apply();
})();
