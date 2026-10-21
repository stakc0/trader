const prompt = document.querySelector('#prompt');
const counter = document.querySelector('#counter');
const status = document.querySelector('#status');
const updateCounter = () => counter.textContent = `${prompt.value.length} / 1000`;
prompt.addEventListener('input', updateCounter);
document.querySelectorAll('.quick-row button').forEach(btn => btn.addEventListener('click', () => { prompt.value = prompt.value ? `${prompt.value}\n${btn.dataset.prompt}` : btn.dataset.prompt; updateCounter(); prompt.focus(); }));
document.querySelector('#advancedToggle').addEventListener('click', () => document.querySelector('#advancedPanel').classList.toggle('open'));
function bindFile(inputId,labelId){document.querySelector(inputId).addEventListener('change',e=>{const f=e.target.files[0];if(f) document.querySelector(labelId).textContent=f.name.length>24?f.name.slice(0,21)+'…':f.name;});}
bindFile('#sourceInput','#sourceLabel'); bindFile('#sheetInput','#sheetLabel');
document.querySelector('#generate').addEventListener('click',()=>{const btn=document.querySelector('#generate'); if(!prompt.value.trim()){status.textContent='Add a prompt or choose a quick action first.'; status.style.color='#ff9c76'; prompt.focus(); return;} btn.disabled=true; btn.textContent='Preparing generation…'; status.style.color='#bbb'; status.textContent='Building character-consistent preview locally…'; setTimeout(()=>{btn.disabled=false;btn.innerHTML='Generate video <span>→</span>';status.style.color='#b5bd89';status.textContent='Preview queued. Connect a generation provider to render the final video.'},900)});
document.querySelectorAll('.model-card').forEach(card=>card.addEventListener('click',()=>{document.querySelectorAll('.model-card').forEach(x=>x.classList.remove('chosen'));card.classList.add('chosen')}));
