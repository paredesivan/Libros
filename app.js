const STORE_KEY='mi-biblioteca-v1';
let books=loadBooks(), activeFilter='all', pendingBook=null, editingId=null, stream=null, scanLock=false;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function loadBooks(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'[]')}catch{return []}}
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(books));render()}
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random()}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function norm(s=''){return s.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function fuzzy(needle,hay){needle=norm(needle);hay=norm(hay);if(!needle)return true;if(hay.includes(needle))return true;return needle.split(' ').every(q=>hay.split(' ').some(w=>w.startsWith(q)||lev(q,w)<=Math.max(1,Math.floor(q.length/3))))}
function lev(a,b){let r=[...Array(b.length+1)].map((_,i)=>i);for(let i=1;i<=a.length;i++){let n=[i];for(let j=1;j<=b.length;j++)n[j]=Math.min(n[j-1]+1,r[j]+1,r[j-1]+(a[i-1]===b[j-1]?0:1));r=n}return r[b.length]}
function cleanIsbn(v){return v.replace(/[^0-9Xx]/g,'').toUpperCase()}

async function fetchJson(url,timeout=12000){
  let controller=new AbortController();
  let timer=setTimeout(()=>controller.abort(),timeout);

  try{
    let response=await fetch(url,{signal:controller.signal});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    return await response.json()
  }finally{
    clearTimeout(timer)
  }
}

function showToast(t){
  let x=$('#toast');
  x.textContent=t;
  x.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t=setTimeout(()=>x.classList.remove('show'),3000)
}

function clearManualInput(){
  if($('#manualInput'))$('#manualInput').value=''
}

function clearLookupAlert(){
  let x=$('#lookupAlert');
  if(x){
    x.hidden=true;
    x.innerHTML=''
  }
}

function cuspideSearchUrl(isbn){
  return `https://cuspide.com/?s=${encodeURIComponent(isbn)}&post_type=product`
}

function showNotFound(isbn){
  let x=$('#lookupAlert');

  if(x){
    x.hidden=false;
    x.innerHTML=`
      No encontramos el ISBN
      <strong>${esc(isbn)}</strong>
      en Open Library ni Google Books.

      Podés buscarlo directamente en Cúspide:

      <br>

      <a
        href="${cuspideSearchUrl(isbn)}"
        target="_blank"
        rel="noopener"
      >
        Buscar ${esc(isbn)} en Cúspide
      </a>
    `
  }

  setScannerStatus(
    'No encontramos el libro en las fuentes automáticas.'
  );

  showToast('No encontramos ese ISBN.')
}

function coverSources(book){
  return [...new Set([
    book.cover,
    ...(book.coverCandidates||[]),
    book.isbn?`https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`:'',
    book.isbn?`https://covers.openlibrary.org/isbn/${book.isbn}-M.jpg`:''
  ].filter(Boolean))]
}

function cover(book,cls='cover'){
  let sources=coverSources(book);

  if(!sources.length){
    return `<div class="cover-placeholder ${cls}">▤</div>`
  }

  return `
    <img
      class="${cls}"
      src="${esc(sources[0])}"
      data-isbn="${esc(book.isbn||'')}"
      data-cover-fallbacks="${esc(JSON.stringify(sources.slice(1)))}"
      alt="Portada de ${esc(book.title)}"
      loading="lazy"
      onerror="coverFallback(this)"
    >
  `
}

async function coverFallback(img){
  if(img.dataset.coverBusy==='1')return;

  let sources=[];

  try{
    sources=JSON.parse(
      img.dataset.coverFallbacks||'[]'
    )
  }catch{}

  let next=sources.shift();

  img.dataset.coverFallbacks=
    JSON.stringify(sources);

  if(next){
    img.src=next;
    return
  }

  let isbn=cleanIsbn(
    img.dataset.isbn||''
  );

  if(isbn){
    img.dataset.coverBusy='1';

    try{
      let data=await fetchJson(
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=5`
      );

      let image=(data.items||[])
        .map(x=>
          x.volumeInfo?.imageLinks?.thumbnail||
          x.volumeInfo?.imageLinks?.smallThumbnail
        )
        .find(Boolean);

      if(image){
        img.dataset.coverBusy='0';
        img.src=image.replace(/^http:/,'https:');
        return
      }
    }catch{}
  }

  let placeholder=document.createElement('div');
  placeholder.className='cover-placeholder';
  placeholder.textContent='▤';
  img.replaceWith(placeholder)
}

window.coverFallback=coverFallback;

function bookText(b){
  return [
    b.title,
    b.author,
    b.isbn,
    b.genre,
    b.description
  ].filter(Boolean).join(' ')
}

function render(){
  $('#totalCount').textContent=books.length;
  $('#readingCount').textContent=books.filter(b=>b.status==='reading').length;
  $('#toReadCount').textContent=books.filter(b=>b.status==='to-read').length;

  const q=$('#searchInput').value;

  const visible=books
    .filter(b=>{
      let f=
        activeFilter==='all' ||
        (
          activeFilter==='favorites'
            ? b.favorite
            : b.status===activeFilter
        );

      return f&&fuzzy(q,bookText(b))
    })
    .sort((a,b)=>
      (b.updatedAt||0)-(a.updatedAt||0)
    );

  $('#emptyState').hidden=
    visible.length>0||books.length>0;

  $('#bookList').innerHTML=
    visible.map(card).join('');

  if(books.length&&visible.length===0){
    $('#emptyState').hidden=false;
    $('#emptyState h3').textContent='No encontramos libros';
    $('#emptyState p').textContent=
      'Probá con menos palabras o con otro filtro.'
  }
  else if(!books.length){
    $('#emptyState h3').textContent=
      'Tu biblioteca está vacía';

    $('#emptyState p').textContent=
      'Escaneá el primer ISBN y tus libros aparecerán acá.'
  }

  renderRecommendations(q)
}

function card(b){
  let pct=b.pages
    ? Math.min(
        100,
        Math.round((b.page||0)/b.pages*100)
      )
    : 0;

  let status={
    reading:'Leyendo',
    'to-read':'Por leer',
    finished:'Terminado'
  }[b.status]||'Por leer';

  let description=b.description
    ? `
      <p class="book-description">
        ${esc(b.description.slice(0,150))}
        ${b.description.length>150?'…':''}
      </p>
    `
    : '';

  return `
    <article
      class="book-card"
      data-open-edit="${b.id}"
      tabindex="0"
    >
      <div>${cover(b)}</div>

      <div class="book-info">
        <h3 class="book-title">
          ${esc(b.title||'Sin título')}
        </h3>

        <p class="book-author">
          ${esc(b.author||'Autor desconocido')}
        </p>

        <div class="book-meta">
          ${esc(b.year||'s/f')} ·
          ${esc(b.genre||'Sin género')}
        </div>

        ${description}

        <span class="status-pill ${
          b.status==='finished'?'finished':''
        }">
          ${status}
        </span>

        ${
          b.pages
          ? `
            <div class="progress">
              <i style="width:${pct}%"></i>
            </div>

            <div class="progress-text">
              pág. ${b.page||0} de ${b.pages}
            </div>
          `
          : ''
        }

        <div class="card-actions">
          <button data-edit="${b.id}">
            Editar lectura
          </button>

          <button
            class="delete-btn"
            data-delete="${b.id}"
          >
            Borrar
          </button>

          <button
            class="favorite"
            data-fav="${b.id}"
            aria-label="Favorito"
          >
            ${b.favorite?'★':'☆'}
          </button>
        </div>
      </div>
    </article>
  `
}

function deleteBook(id){
  let b=books.find(x=>x.id===id);

  if(!b)return;

  if(confirm(`¿Borrar "${b.title}" de tu biblioteca?`)){
    books=books.filter(x=>x.id!==id);
    save();
    showToast('Libro borrado.')
  }
}

async function lookupISBN(raw){
  let isbn=cleanIsbn(raw);

  if(!isbn||![10,13].includes(isbn.length)){
    showToast(
      'El ISBN debe tener 10 o 13 dígitos.'
    );
    return
  }

  clearLookupAlert();

  setScannerStatus(
    'Buscando datos del libro…'
  );

  try{
    let r=await fetch(
      `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`
    );

    if(!r.ok)throw Error();

    let d=await r.json();
    let work=(d.works||[])[0];
    let wd={};

    if(work?.key){
      try{
        let wr=await fetch(
          'https://openlibrary.org'+work.key+'.json'
        );

        if(wr.ok)wd=await wr.json()
      }catch{}
    }

    let authors=(d.authors||[])
      .map(a=>a.name)
      .filter(Boolean);

    if(!authors.length){
      authors=(wd.authors||[])
        .map(a=>a.author?.key)
        .filter(Boolean)
        .slice(0,3);

      authors=await Promise.all(
        authors.map(async k=>{
          try{
            let ar=await fetch(
              'https://openlibrary.org'+k+'.json'
            );

            return (await ar.json()).name
          }catch{
            return ''
          }
        })
      )
    }

    let subjects=(d.subjects||wd.subjects||[])
      .filter(x=>typeof x==='string')
      .slice(0,8);

    let description=d.description||wd.description||'';

    if(typeof description==='object'){
      description=description.value||''
    }

    description=String(description)
      .replace(/<[^>]*>/g,'')
      .replace(/\s+/g,' ')
      .trim();

    let title=d.title||wd.title||'Sin título';

    let googleCover='';

    try{
      let gd=await fetchJson(
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=5`
      );

      let gv=(gd.items||[])[0]?.volumeInfo||{};

      googleCover=(
        gv.imageLinks?.thumbnail||
        gv.imageLinks?.smallThumbnail||
        ''
      ).replace(/^http:/,'https:');

      if(!description&&gv.description){
        description=String(gv.description)
          .replace(/<[^>]*>/g,'')
          .replace(/\s+/g,' ')
          .trim()
      }
    }catch{}

    let openLibraryCovers=(d.covers||[])
      .map(id=>
        `https://covers.openlibrary.org/b/id/${id}-M.jpg`
      );

    let coverCandidates=[
      googleCover,
      ...openLibraryCovers,
      `https://covers.openlibrary.org/isbn/${isbn}-M.jpg`
    ].filter(Boolean);

    pendingBook={
      id:uid(),
      isbn,
      title,
      author:authors.join(', ')||'Autor desconocido',
      year:d.publish_date?.match(/\d{4}/)?.[0]||'',
      genre:subjects[0]||'Sin género',
      genres:subjects,
      description,
      pages:d.number_of_pages||0,
      cover:coverCandidates[0]||'',
      coverCandidates:coverCandidates.slice(1),
      status:'to-read',
      page:0,
      notes:'',
      favorite:false,
      createdAt:Date.now(),
      updatedAt:Date.now()
    };

    showBookPreview();
    closeDialog('scannerDialog');
    $('#bookDialog').showModal()

  }catch{
    try{
      setScannerStatus(
        'Probando la búsqueda ampliada de Open Library…'
      );

      pendingBook=
        await lookupOpenLibrarySearch(isbn);

      showBookPreview();
      closeDialog('scannerDialog');
      $('#bookDialog').showModal()

    }catch{
      try{
        setScannerStatus(
          'Open Library no lo encontró. Probando Google Books…'
        );

        pendingBook=
          await lookupGoogleBooks(isbn);

        showBookPreview();
        closeDialog('scannerDialog');
        $('#bookDialog').showModal()

      }catch{
        showNotFound(isbn)
      }
    }
  }
}

async function lookupOpenLibrarySearch(isbn){
  let data=await fetchJson(
    `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=5`
  );

  let v=(data.docs||[])[0];

  if(!v?.title){
    throw Error()
  }

  let coverCandidates=[];

  if(v.cover_i){
    coverCandidates.push(
      `https://covers.openlibrary.org/b/id/${v.cover_i}-M.jpg`
    )
  }

  coverCandidates.push(
    `https://covers.openlibrary.org/isbn/${isbn}-M.jpg`
  );

  return{
    id:uid(),
    isbn,
    title:v.title||'Sin título',
    author:(v.author_name||[]).join(', ')||'Autor desconocido',
    year:String(v.first_publish_year||'')
      .match(/\d{4}/)?.[0]||'',
    genre:v.subject?.[0]||'Sin género',
    genres:(v.subject||[]).slice(0,8),
    description:'',
    pages:v.number_of_pages_median||0,
    cover:coverCandidates[0]||'',
    coverCandidates:coverCandidates.slice(1),
    status:'to-read',
    page:0,
    notes:'',
    favorite:false,
    createdAt:Date.now(),
    updatedAt:Date.now()
  }
}

async function lookupGoogleBooks(isbn){
  let data=await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=5`
  );

  let item=(data.items||[])[0];

  if(!item?.volumeInfo){
    throw Error()
  }

  let v=item.volumeInfo;

  let image=
    v.imageLinks?.thumbnail||
    v.imageLinks?.smallThumbnail||
    '';

  return{
    id:uid(),
    isbn,
    title:v.title||'Sin título',
    author:(v.authors||[]).join(', ')||'Autor desconocido',
    year:v.publishedDate?.match(/\d{4}/)?.[0]||'',
    genre:v.categories?.[0]||'Sin género',
    genres:v.categories||[],
    description:String(v.description||'')
      .replace(/<[^>]*>/g,'')
      .replace(/\s+/g,' ')
      .trim(),
    pages:v.pageCount||0,
    cover:image.replace(/^http:/,'https:'),
    coverCandidates:[
      `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
      `https://covers.openlibrary.org/isbn/${isbn}-M.jpg`
    ],
    status:'to-read',
    page:0,
    notes:'',
    favorite:false,
    createdAt:Date.now(),
    updatedAt:Date.now()
  }
}

function showBookPreview(){
  let b=pendingBook;

  $('#bookPreview').innerHTML=`
    ${cover(b)}

    <div class="preview-copy">
      <h3>${esc(b.title)}</h3>
      <p>${esc(b.author)}</p>

      <p>
        ${esc(b.year||'Año no disponible')}
        ·
        ${esc(b.genre)}
      </p>

      <p>
        ${esc(
          (b.description||
          'Sin descripción disponible.')
          .slice(0,240)
        )}
      </p>
    </div>
  `
}

function setScannerStatus(t){
  $('#scannerStatus').textContent=t
}

async function startScanner(){
  try{
    clearManualInput();
    clearLookupAlert();

    $('#scannerDialog').showModal();

    setScannerStatus(
      'Buscando un código de barras…'
    );

    stream=await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{
          ideal:'environment'
        }
      }
    });

    $('#video').srcObject=stream;
    await $('#video').play();

    if('BarcodeDetector' in window){
      let detector=new BarcodeDetector({
        formats:[
          'ean_13',
          'ean_8',
          'upc_a',
          'upc_e'
        ]
      });

      scanLock=false;

      const loop=async()=>{
        if(!$('#scannerDialog').open||scanLock){
          return
        }

        try{
          let codes=
            await detector.detect($('#video'));

          if(codes[0]?.rawValue){
            scanLock=true;
            await lookupISBN(
              codes[0].rawValue
            );
            return
          }
        }catch{}

        requestAnimationFrame(loop)
      };

      loop()
    }
    else{
      setScannerStatus(
        'Tu navegador no activa el lector automático. Escribí el ISBN abajo.'
      )
    }
  }catch{
    setScannerStatus(
      'No se pudo abrir la cámara. Revisá el permiso o escribí el ISBN abajo.'
    )
  }
}

function stopScanner(){
  if(stream){
    stream.getTracks().forEach(
      t=>t.stop()
    );

    stream=null
  }

  scanLock=true
}

function closeDialog(id){
  let d=document.getElementById(id);

  if(d.open)d.close();

  if(id==='scannerDialog'){
    stopScanner()
  }
}

function savePending(andScan=false){
  if(!pendingBook)return;

  let duplicate=books.find(
    b=>b.isbn===pendingBook.isbn
  );

  if(duplicate){
    showToast(
      'Ese libro ya está en tu biblioteca.'
    );

    pendingBook=null;
    clearManualInput();
    closeDialog('bookDialog');
    return
  }

  books.unshift(pendingBook);
  pendingBook=null;
  clearManualInput();
  save();
  closeDialog('bookDialog');

  showToast(
    'Libro guardado en tu biblioteca.'
  );

  if(andScan){
    setTimeout(startScanner,250)
  }
}

let recommendationTimer;

function renderRecommendations(searchText=''){
  let rec=$('#recommendations');
  let list=$('#recommendationList');

  if(!books.length&&!searchText.trim()){
    rec.hidden=true;
    return
  }

  let genre=books
    .flatMap(b=>
      b.genres?.length
        ? b.genres
        : [b.genre]
    )
    .filter(Boolean)[0];

  if(!genre&&!searchText){
    rec.hidden=true;
    return
  }

  clearTimeout(recommendationTimer);

  recommendationTimer=setTimeout(()=>{
    let query=searchText.trim();

    let endpoint=query
      ? `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8`
      : `https://openlibrary.org/search.json?subject=${encodeURIComponent(genre)}&limit=8`;

    $('#recommendations .eyebrow').textContent=
      query
        ? 'RESULTADOS PARECIDOS'
        : 'A PARTIR DE TUS GÉNEROS';

    $('#recommendations h2').textContent=
      query
        ? '¿Buscabas alguno de estos?'
        : 'Podría interesarte';

    fetch(endpoint)
      .then(r=>r.json())
      .then(data=>{
        let owned=new Set(
          books.map(b=>norm(b.title))
        );

        let items=(data.docs||[])
          .filter(x=>
            x.title&&!owned.has(norm(x.title))
          )
          .slice(0,4);

        list.innerHTML=items.map(x=>{
          let isbn=x.isbn?.[0];

          let c=isbn
            ? `https://covers.openlibrary.org/isbn/${isbn}-M.jpg`
            : '';

          let buyQuery=encodeURIComponent(
            `${x.title} ${x.author_name?.[0]||''}`
          );

          return`
            <article class="recommendation-card">
              ${cover({
                title:x.title,
                isbn,
                cover:c
              })}

              <h3 class="book-title">
                ${esc(x.title)}
              </h3>

              <p class="book-author">
                ${esc(x.author_name?.[0]||'')}
              </p>

              <div class="buy-links">
                <a
                  target="_blank"
                  rel="noopener"
                  href="https://listado.mercadolibre.com.ar/${buyQuery}"
                >
                  Mercado Libre
                </a>
              </div>
            </article>
          `
        }).join('');

        rec.hidden=!items.length
      })
      .catch(()=>{})
  },250)
}

function openEdit(id){
  let b=books.find(x=>x.id===id);

  if(!b)return;

  editingId=id;

  $('#editTitle').textContent=b.title;
  $('#editStatus').value=b.status;
  $('#editPage').value=b.page||0;
  $('#editPage').max=b.pages||'';
  $('#pageHint').textContent=
    b.pages?`de ${b.pages}`:'';
  $('#editFavorite').checked=!!b.favorite;
  $('#editNotes').value=b.notes||'';

  $('#editDialog').showModal()
}

$('#scanBtn').onclick=startScanner;

$('#manualBtn').onclick=()=>{
  clearManualInput();
  clearLookupAlert();

  $('#scannerDialog').showModal();

  setScannerStatus(
    'Escribí un ISBN para buscarlo.'
  );

  $('#manualInput').focus()
};

$('#manualLookupBtn').onclick=()=>{
  lookupISBN(
    $('#manualInput').value
  )
};

$('#manualInput').addEventListener(
  'keydown',
  e=>{
    if(e.key==='Enter'){
      lookupISBN(e.target.value)
    }
  }
);

$('#confirmBookBtn').onclick=()=>{
  savePending(false)
};

$('#scanNextBtn').onclick=()=>{
  savePending(true)
};

$('#settingsBtn').onclick=()=>{
  $('#settingsDialog').showModal()
};

$('#searchInput').oninput=render;

$('#exportBtn').onclick=exportData;
$('#settingsExportBtn').onclick=exportData;

$('#importBtn').onclick=()=>{
  $('#importFile').click()
};

$('#importFile').onchange=e=>{
  let f=e.target.files[0];

  if(!f)return;

  let r=new FileReader();

  r.onload=()=>{
    try{
      let incoming=JSON.parse(r.result);

      if(!Array.isArray(incoming)){
        throw Error()
      }

      books=[
        ...incoming,
        ...books.filter(b=>
          !incoming.some(i=>i.isbn===b.isbn)
        )
      ];

      save();
      showToast('Copia importada.')
    }catch{
      showToast(
        'Ese archivo no es válido.'
      )
    }
  };

  r.readAsText(f)
};

$('#editForm').onsubmit=e=>{
  e.preventDefault();

  let b=books.find(
    x=>x.id===editingId
  );

  if(b){
    b.status=$('#editStatus').value;
    b.page=Number($('#editPage').value)||0;
    b.favorite=$('#editFavorite').checked;
    b.notes=$('#editNotes').value;
    b.updatedAt=Date.now();

    save();
    closeDialog('editDialog');

    showToast(
      'Seguimiento actualizado.'
    )
  }
};

document.addEventListener('click',e=>{
  let edit=e.target.closest('[data-edit]');
  let fav=e.target.closest('[data-fav]');
  let del=e.target.closest('[data-delete]');
  let cardEl=e.target.closest('[data-open-edit]');
  let close=e.target.closest('[data-close]');

  if(edit){
    openEdit(edit.dataset.edit)
  }

  if(fav){
    let b=books.find(
      x=>x.id===fav.dataset.fav
    );

    if(b){
      b.favorite=!b.favorite;
      b.updatedAt=Date.now();
      save()
    }
  }

  if(del){
    deleteBook(del.dataset.delete)
  }

  if(
    cardEl &&
    !e.target.closest('button,a')
  ){
    openEdit(cardEl.dataset.openEdit)
  }

  if(close){
    closeDialog(close.dataset.close)
  }
});

document.addEventListener('keydown',e=>{
  if(
    (e.key==='Enter'||e.key===' ') &&
    e.target.matches('[data-open-edit]')
  ){
    e.preventDefault();
    openEdit(e.target.dataset.openEdit)
  }
});

$$('.filter').forEach(b=>{
  b.onclick=()=>{
    $$('.filter').forEach(x=>
      x.classList.remove('active')
    );

    b.classList.add('active');
    activeFilter=b.dataset.filter;
    render()
  }
});

$('#clearBtn').onclick=()=>{
  if(confirm(
    '¿Borrar todos los libros? Esta acción no se puede deshacer.'
  )){
    books=[];
    save();
    closeDialog('settingsDialog');
    showToast('Biblioteca borrada.')
  }
};

function exportData(){
  let blob=new Blob(
    [JSON.stringify(books,null,2)],
    {type:'application/json'}
  );

  let a=document.createElement('a');

  a.href=URL.createObjectURL(blob);
  a.download='mi-biblioteca-copia.json';
  a.click();

  URL.revokeObjectURL(a.href);

  showToast('Copia descargada.')
}

render();
