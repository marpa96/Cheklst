// Offer a retry if the app module fails to start (e.g. a broken cached update).
setTimeout(()=>{
  const message=document.querySelector('#startup-message'),button=document.querySelector('#startup-retry');
  if(!message||!button)return;
  message.textContent='Opening is taking longer than expected.';
  button.hidden=false;button.onclick=()=>location.reload();
},8000);
