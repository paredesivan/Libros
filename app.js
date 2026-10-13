const STORE_KEY='mi-biblioteca-v1';
let books=loadBooks(), activeFilter='all', pendingBook=null, editingId=null, stream=null, scanLock=false;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function loadBooks(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'[]')}catch{return []}}

function save(){
  localStorage.setItem(STORE_KEY,JSON.stringify(books));
  render()
}

function uid(){
  return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random()
}

function esc(s=''){
  return String(s).replace(/[&<>'"]/g,c=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    "'":'&#39;',
    '"':'&quot;'
  }[c]))
}

function norm(s=''){
  return s.toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
}

function fuzzy(needle,hay){
  needle=norm(needle);
  hay=norm(hay);

  if(!needle)return true;
  if(hay.includes(needle))return true;

  return needle.split(' ').every(q=>
    hay.split(' ').some(w=>
      w.startsWith(q) ||
      lev(q,w)<=Math.max(1,Math.floor(q.length/3))
    )
  )
}

function lev(a,b){
  let r=[...Array(b.length+1)].map((_,i)=>i);

  for(let i=1;i<=a.length;i++){
    let n=[i];

    for(let j=1;j<=b.length;j++){
      n[j]=Math.min(
        n[j-1]+1,
        r[j]+1,
        r[j-1]+(a[i-1]===b[j-1]?0:1)
      )
    }

    r=n
  }

  return r[b.length]
}

function cleanIsbn(v){
  return v.replace(/[^0-9Xx]/g,'').toUpperCase()
}

function showToast(t){
  let x=$('#toast');
  x.textContent=t;
  x.classList.add('show');

  clearTimeout(showToast.t);

  showToast.t=setTimeout(
    ()=>x.classList.remove('show'),
    3000
  )
}

function cover(book,cls='cover'){
  return book.cover
    ? `<img class="${cls}" src="${esc(book.cover)}" alt="Portada de ${esc(book.title)}" loading="lazy">`
    : `<div class="cover-placeholder ${cls}">▤</div>`
}

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

  $('#readingCount').textContent=
    books.filter(b=>b.status==='reading').length;

  $('#toReadCount').textContent=
    books.filter(b=>b.status==='to-read').length;

  const q=$('#searchInput').value;

  const visible=books
    .filter(b=>{
      let f=
        activeFilter==='all' ||
        (activeFilter==='favorites'
          ? b.favorite
          : b.status===activeFilter);

      return f&&fuzzy(q,bookText(b))
    })
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));

  $('#emptyState').hidden=
    visible.length>0||books.length>0;

  $('#bookList').innerHTML=
    visible.map(card).join('');

  if(books.length&&visible.length===0){
    $('#emptyState').hidden=false;
    $('#emptyState h3').textContent='No encontramos libros';
    $('#emptyState p').textContent=
      'Probá con menos palabras o con otro filtro.'
  }else if(!books.length){
    $('#emptyState h3').textContent=
      'Tu biblioteca está vacía';

    $('#emptyState p').textContent=
      'Escaneá el primer ISBN y tus libros aparecerán acá.'
  }

  renderRecommendations(q);
}

function card(b){
  let pct=b.pages
    ? Math.min(100,Math.round((b.page||0)/b.pages*100))
    : 0;

  let status={
    reading:'Leyendo',
    'to-read':'Por leer',
    finished:'Terminado'
  }[b.status]||'Por leer';

  return `
    <article class="book-card">
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

        <span class="status-pill ${b.status==='finished'?'finished':''}">
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
          :''
        }

        <div class="card-actions">
          <button data-edit="${b.id}">
            Editar lectura
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

async function lookupISBN(raw){
  let isbn=cleanIsbn(raw);

  if(!isbn||![10,13].includes(isbn.length)){
    showToast('El ISBN debe tener 10 o 13 dígitos.');
    return
  }

  setScannerStatus('Buscando datos del libro…');

  try{
    let r=await fetch(
      `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`
    );

    if(!r.ok)throw Error();

    let d=await r.json();

    let work=(d.works||[])[0];

    let title=d.title||'Sin título';

    let authors=(d.authors||[])
      .map(a=>a.name)
      .filter(Boolean);

    if(!authors.length&&work?.key){
      let wr=await fetch(
        'https://openlibrary.org'+work.key+'.json'
      );

      let wd=await wr.json();

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

    let subjects=(d.subjects||work?.subjects||[])
      .slice(0,5);

    pendingBook={
      id:uid(),
      isbn,
      title,
      author:authors.join(', ')||'Autor desconocido',
      year:d.publish_date?.match(/\d{4}/)?.[0]||'',
      genre:subjects[0]||'Sin género',
      genres:subjects,
      description:
        d.description?.value||
        work?.description?.value||
        '',
      pages:d.number_of_pages||0,
      cover:`https://covers.openlibrary.org/isbn/${isbn}-M.jpg`,
      status:'to-read',
      page:0,
      notes:'',
      favorite:false,
      createdAt:Date.now(),
      updatedAt:Date.now()
    };

    if(d.cover_i===undefined){
      pendingBook.cover=''
    }

    showBookPreview();
    closeDialog('scannerDialog');
    $('#bookDialog').showModal();

  }catch{
    setScannerStatus('');

    showToast(
      'No encontramos ese ISBN. Podés revisar los números e intentar otra vez.'
    )
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
        ${esc(b.year||'Año no disponible')} ·
        ${esc(b.genre)}
      </p>
      <p>
        ${esc(
          (b.description||'Sin descripción disponible.')
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
    $('#scannerDialog').showModal();

    setScannerStatus('Buscando un código de barras…');

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
        if(!$('#scannerDialog').open||scanLock)return;

        try{
          let codes=await detector.detect($('#video'));

          if(codes[0]?.rawValue){
            scanLock=true;
            await lookupISBN(codes[0].rawValue);
            return
          }
        }catch{}

        requestAnimationFrame(loop)
      };

      loop()
    }else{
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
    stream.getTracks().forEach(t=>t.stop());
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
    showToast('Ese libro ya está en tu biblioteca.');
    pendingBook=null;
    closeDialog('bookDialog');
    return
  }

  books.unshift(pendingBook);
  pendingBook=null;

  save();

  closeDialog('bookDialog');

  showToast('Libro guardado en tu biblioteca.');

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
    .flatMap(b=>b.genres?.length?b.genres:[b.genre])
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

    $('#recommendations .eyebrow').textContent=query
      ? 'RESULTADOS PARECIDOS'
      : 'A PARTIR DE TUS GÉNEROS';

    $('#recommendations h2').textContent=query
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
            :'';

          let buyQuery=encodeURIComponent(
            `${x.title} ${x.author_name?.[0]||''}`
          );

          return `
            <article class="recommendation-card">
              ${
                c
                ? `<img class="cover" src="${c}" alt="">`
                :''
              }

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

                <a
                  target="_blank"
                  rel="noopener"
                  href="https://www.google.com/search?q=${buyQuery}+site%3Acuspide.com"
                >
                  Cúspide
                </a>

                <a
                  target="_blank"
                  rel="noopener"
                  href="https://www.google.com/search?q=${buyQuery}+site%3Asbs.com.ar"
                >
                  SBS
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
  $('#pageHint').textContent=b.pages?`de ${b.pages}`:'';
  $('#editFavorite').checked=!!b.favorite;
  $('#editNotes').value=b.notes||'';

  $('#editDialog').showModal()
}

$('#scanBtn').onclick=startScanner;

$('#manualBtn').onclick=()=>{
  $('#scannerDialog').showModal();
  setScannerStatus('Escribí un ISBN para buscarlo.');
  $('#manualInput').focus()
};

$('#manualLookupBtn').onclick=()=>{
  lookupISBN($('#manualInput').value)
};

$('#manualInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    lookupISBN(e.target.value)
  }
});

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

      if(!Array.isArray(incoming))throw Error();

      books=[
        ...incoming,
        ...books.filter(
          b=>!incoming.some(i=>i.isbn===b.isbn)
        )
      ];

      save();

      showToast('Copia importada.')
    }catch{
      showToast('Ese archivo no es válido.')
    }
  };

  r.readAsText(f)
};

$('#editForm').onsubmit=e=>{
  e.preventDefault();

  let b=books.find(x=>x.id===editingId);

  if(b){
    b.status=$('#editStatus').value;
    b.page=Number($('#editPage').value)||0;
    b.favorite=$('#editFavorite').checked;
    b.notes=$('#editNotes').value;
    b.updatedAt=Date.now();

    save();

    closeDialog('editDialog');

    showToast('Seguimiento actualizado.')
  }
};

document.addEventListener('click',e=>{
  let edit=e.target.closest('[data-edit]');
  let fav=e.target.closest('[data-fav]');

  if(edit){
    openEdit(edit.dataset.edit)
  }

  if(fav){
    let b=books.find(
      x=>x.id===fav.dataset.fav
    );

    b.favorite=!b.favorite;
    b.updatedAt=Date.now();

    save()
  }

  let c=e.target.closest('[data-close]');

  if(c){
    closeDialog(c.dataset.close)
  }
});

$$('.filter').forEach(b=>{
  b.onclick=()=>{
    $$('.filter').forEach(
      x=>x.classList.remove('active')
    );

    b.classList.add('active');
    activeFilter=b.dataset.filter;
    render()
  }
});

$('#clearBtn').onclick=()=>{
  if(confirm('¿Borrar todos los libros? Esta acción no se puede deshacer.')){
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
