// Indicadores front-end: files + gallery with simple role checks and localStorage persistence

(function(){
  const ROLE_KEY = 'sme_user_role'; // set to 'admin' for admin

  function getUserRole(){
    // Try window global, then localStorage, default 'user'
    return window.USER_ROLE || localStorage.getItem(ROLE_KEY) || 'user';
  }

  // Files area
  const filesArea = document.getElementById('files-area');
  const filesAdminActions = document.getElementById('files-admin-actions');
  const addFileButton = document.getElementById('add-file-button');

  // Images
  const imageGallery = document.getElementById('image-gallery');
  const imagesAdminActions = document.getElementById('images-admin-actions');
  const uploadImagesButton = document.getElementById('upload-images-button');
  const imageUploadInput = document.getElementById('image-upload');

  // Lightbox
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightbox-image');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxPrev = document.getElementById('lightbox-prev');
  const lightboxNext = document.getElementById('lightbox-next');

  const STORAGE_KEY = 'sme_indicadores_data_v1';
  const DEFAULT_IMAGES = Array.from({ length: 37 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { id: `default-${number}`, name: `Imagem ${number}`, dataUrl: `IMG/${number}.jpg` };
  });

  let state = {
    files: [], // {id, name, desc, mime, dataUrl}
    images: [] // {id, name, dataUrl}
  };

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) state = JSON.parse(raw);
    }catch(e){ console.error(e); }
  }

  function renderFiles(){
    filesArea.innerHTML = '';

    if(state.files.length === 0){
      return;
    }

    state.files.forEach(f=>{
      const card = document.createElement('div');
      card.className = 'file-card full-width-card';
      const header = document.createElement('div');
      header.className = 'card-header';

      const titleWrap = document.createElement('div');
      const fileLink = document.createElement('a');
      fileLink.href = f.dataUrl;
      fileLink.target = '_blank';
      fileLink.rel = 'noopener noreferrer';
      fileLink.className = 'file-link';
      fileLink.textContent = f.name;
      titleWrap.appendChild(fileLink);
      header.appendChild(titleWrap);

      const actions = document.createElement('div');
      actions.style.display='flex'; actions.style.gap='8px';

      if(isAdmin()){
        const editBtn = document.createElement('button');
        editBtn.className='btn-primary';
        editBtn.textContent='Editar descrição';
        editBtn.onclick = ()=>{ editDescription(f.id); };
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className='btn-secondary';
        delBtn.textContent='Excluir';
        delBtn.onclick = ()=>{ if(confirm('Excluir este arquivo?')){ deleteFile(f.id); } };
        actions.appendChild(delBtn);
      }

      header.appendChild(actions);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className='card-body show';
      body.innerHTML = `<p>${escapeHtml(f.desc||'Sem descrição.')}</p>`;
      card.appendChild(body);

      filesArea.appendChild(card);
    });
  }

  function renderImages(){
    imageGallery.innerHTML='';

    const galleryImages = state.images.length > 0 ? state.images : DEFAULT_IMAGES;

    galleryImages.forEach((img, idx)=>{
      const wrap = document.createElement('div');
      wrap.className='gallery-thumb';
      const imageEl = document.createElement('img');
      imageEl.src = img.dataUrl;
      imageEl.alt = img.name || ('Imagem '+(idx+1));
      imageEl.loading='lazy';
      imageEl.onclick = ()=> openLightbox(idx);
      imageEl.onerror = () => {
        imageEl.style.display = 'none';
      };
      wrap.appendChild(imageEl);

      if(isAdmin() && state.images.length > 0){
        const del = document.createElement('button');
        del.className='btn-secondary thumb-delete';
        del.textContent='Excluir';
        del.onclick = (e)=>{ e.stopPropagation(); if(confirm('Excluir imagem?')){ deleteImage(img.id); } };
        wrap.appendChild(del);
      }

      imageGallery.appendChild(wrap);
    });
  }

  function isAdmin(){
    // If explicit admin role is set
    if (getUserRole()==='admin') return true;
    // If no authentication info present (for testing), show admin controls by default
    const hasSession = !!(localStorage.getItem('sme_session_token') || localStorage.getItem('sme_user'));
    if (!hasSession) return true;
    return false;
  }

  function editDescription(id){
    const file = state.files.find(f=>f.id===id);
    if(!file) return;
    const newDesc = prompt('Descrição do documento:', file.desc||'');
    if(newDesc!==null){ file.desc = newDesc; saveState(); renderFiles(); }
  }

  function deleteFile(id){ state.files = state.files.filter(f=>f.id!==id); saveState(); renderFiles(); }
  function deleteImage(id){ state.images = state.images.filter(i=>i.id!==id); saveState(); renderImages(); }

  function addFiles(files, desc){
    const readers = [];
    Array.from(files).forEach(file=>{
      const r = new FileReader();
      r.onload = (e)=>{
        state.files.push({ id: 'f_'+Date.now()+'_'+Math.random().toString(36).slice(2,8), name: file.name, mime: file.type, dataUrl: e.target.result, desc: desc || '' });
        saveState(); renderFiles();
      };
      r.readAsDataURL(file);
      readers.push(r);
    });
  }

  function addImages(files){
    Array.from(files).forEach(file=>{
      const r = new FileReader();
      r.onload = (e)=>{
        state.images.push({ id: 'i_'+Date.now()+'_'+Math.random().toString(36).slice(2,8), name: file.name, dataUrl: e.target.result });
        saveState(); renderImages();
      };
      r.readAsDataURL(file);
    });
  }

  // Lightbox behaviour
  let currentLightboxIndex = 0;
  function openLightbox(index){
    currentLightboxIndex = index;
    const img = state.images[index];
    if(!img) return;
    lightboxImage.src = img.dataUrl;
    lightbox.classList.remove('hidden');
  }
  function closeLightbox(){ lightbox.classList.add('hidden'); }
  function nextLightbox(){ currentLightboxIndex = (currentLightboxIndex+1)%state.images.length; openLightbox(currentLightboxIndex); }
  function prevLightbox(){ currentLightboxIndex = (currentLightboxIndex-1+state.images.length)%state.images.length; openLightbox(currentLightboxIndex); }

  // swipe support
  let touchStartX = 0;
  lightboxImage.addEventListener('touchstart', (e)=>{ touchStartX = e.touches[0].clientX; });
  lightboxImage.addEventListener('touchend', (e)=>{
    const delta = (e.changedTouches[0].clientX - touchStartX);
    if(Math.abs(delta)>40){ if(delta<0) nextLightbox(); else prevLightbox(); }
  });

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxNext.addEventListener('click', nextLightbox);
  lightboxPrev.addEventListener('click', prevLightbox);

  // hooks
  addFileButton && addFileButton.addEventListener('click', ()=>{
    const input = document.createElement('input');
    input.type='file';
    input.multiple = true;
    input.onchange = ()=>{
      const descField = document.getElementById('file-desc');
      const descVal = descField ? descField.value.trim() : '';
      addFiles(input.files, descVal);
      if(descField) descField.value = '';
    };
    input.click();
  });

  uploadImagesButton && uploadImagesButton.addEventListener('click', ()=> imageUploadInput.click());
  imageUploadInput && imageUploadInput.addEventListener('change', ()=> addImages(imageUploadInput.files));

  // util
  function escapeHtml(s){ if(!s) return ''; return s.replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]; }); }

  // init
  loadState();
  document.addEventListener('DOMContentLoaded', ()=>{
    // show admin controls if admin (or no auth present -> testing)
    if(isAdmin()){
      filesAdminActions && (filesAdminActions.style.display='flex');
      imagesAdminActions && (imagesAdminActions.style.display='flex');
    }
    renderFiles();
    renderImages();
  });

  // expose role helper for quick testing
  window.setSmeRole = function(r){ localStorage.setItem(ROLE_KEY, r); location.reload(); };

})();
