// Network-first app shell: online you always get the latest app; offline the cached copy opens.
// Checklist data lives in localStorage, not here; GitHub requests are never cached.
const CACHE='cheklst-v3';
const FILES=['./','./index.html','./style.css','./theme.js','./startup.js','./app.js','./core.js','./calc.js','./library.js','./editor.js','./links.js','./widgets.js','./ambient.js','./motion.js','./toast.js','./sheet.js','./command.js','./schedule.js','./library.json','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('cheklst-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(event.request,{cache:'no-cache'});
      if(response.ok){const cache=await caches.open(CACHE);cache.put(event.request,response.clone());}
      return response;
    }catch(error){
      const cached=await caches.match(event.request,{ignoreSearch:true});
      if(cached)return cached;
      if(event.request.mode==='navigate')return caches.match('./index.html');
      throw error;
    }
  })());
});
