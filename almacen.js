/* =====================================================
   Punto Base · Módulo Almacén
   /modulos/almacen.js

   Se carga dinámicamente desde index.html cuando
   empresa.tipo === 'almacen'. No modifica nada del
   core de auth ni de la landing pública.

   Dependencias globales que ya provee index.html:
     - window.supabase  (cliente Supabase)
     - window.usuarioActual  { id, nombre, rol, clinicaId, clinica }
     - CSS ya cargado del index.html (mismas variables y clases)
   ===================================================== */

/* ---- Estado del módulo ---- */
let productos = [];
let movimientos = [];
let productoEditandoId = null;
let filtroBusqueda = '';
let filtroEstado = 'activo'; // 'activo' | 'todos'

/* =====================================================
   INIT — punto de entrada llamado desde index.html
   ===================================================== */
export async function initAlmacen() {
  inyectarPaneles();
  inyectarCSS();
  await cargarDatos();
  bindEventos();
  renderTodo();
}

/* =====================================================
   CARGA DE DATOS
   ===================================================== */
async function cargarDatos() {
  const sb = window.supabase;

  const [resProductos, resMovimientos] = await Promise.all([
    sb.from('productos').select('*').order('nombre'),
    sb.from('movimientos_stock').select('*').order('creado_en', { ascending: false }),
  ]);

  if (resProductos.error) console.error('Error productos:', resProductos.error);
  if (resMovimientos.error) console.error('Error movimientos:', resMovimientos.error);

  productos = resProductos.data || [];
  movimientos = resMovimientos.data || [];
}

/* =====================================================
   INYECCIÓN DE PANELES EN EL DOM
   Añade las pestañas y los paneles al área de la app
   que ya existe en index.html, sin tocar nada más.
   ===================================================== */
function inyectarPaneles() {
  /* --- Pestañas en .app-tabs --- */
  const tabContainer = document.querySelector('.app-tabs');
  if (tabContainer) {
    tabContainer.innerHTML = `
      <button class="app-tab activo" data-panel="alm-panel">Panel</button>
      <button class="app-tab" data-panel="alm-catalogo">Catálogo</button>
      <button class="app-tab" data-panel="alm-movimientos">Movimientos</button>
    `;
    tabContainer.querySelectorAll('.app-tab').forEach(t =>
      t.addEventListener('click', () => cambiarPanelAlmacen(t.dataset.panel))
    );
  }

  /* --- Paneles en .app-cuerpo > .contenedor --- */
  const contenedor = document.querySelector('.app-cuerpo .contenedor');
  if (!contenedor) return;
  contenedor.innerHTML = `

    <!-- PANEL: resumen del almacén -->
    <div class="app-panel activo" id="panel-alm-panel">
      <h2>Panel del almacén</h2>
      <p class="sub" style="margin-bottom:24px">Resumen de stock y últimos movimientos.</p>

      <div class="metricas" id="alm-metricas"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:8px" id="alm-grid-panel">
        <div class="tarjeta">
          <h3>Stock crítico (≤ 5 unidades)</h3>
          <div id="alm-criticos"></div>
        </div>
        <div class="tarjeta">
          <h3>Últimos movimientos</h3>
          <div id="alm-ultimos-mov"></div>
        </div>
      </div>
    </div>

    <!-- PANEL: catálogo de productos -->
    <div class="app-panel" id="panel-alm-catalogo">
      <h2>Catálogo de productos</h2>
      <p class="sub" style="margin-bottom:24px">Añade, edita o desactiva productos. Cada producto tiene nombre, descripción y stock actual.</p>

      <div class="grid-app">

        <!-- Formulario nuevo / edición -->
        <div class="tarjeta" id="alm-form-wrap">
          <h3 id="alm-form-titulo">Nuevo producto</h3>
          <div class="campo-grupo">
            <label for="alm-nombre">Nombre *</label>
            <input type="text" id="alm-nombre" placeholder="Ej.: Caja de guantes M">
          </div>
          <div class="campo-grupo">
            <label for="alm-descripcion">Descripción (opcional)</label>
            <textarea id="alm-descripcion" placeholder="Ej.: Guantes de nitrilo, talla M, caja de 100 uds." style="min-height:72px;resize:vertical"></textarea>
          </div>
          <div class="campo-grupo">
            <label for="alm-stock-inicial">Stock inicial</label>
            <input type="number" id="alm-stock-inicial" min="0" value="0" placeholder="0">
          </div>
          <p class="aviso-resv" id="alm-aviso-form"></p>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primario btn-bloque" id="alm-btn-guardar" onclick="window._almGuardar()">Guardar producto</button>
            <button class="btn btn-fantasma" id="alm-btn-cancelar" onclick="window._almCancelar()" style="display:none">Cancelar</button>
          </div>
        </div>

        <!-- Lista de productos -->
        <div>
          <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <input type="text" id="alm-busca" placeholder="🔍 Buscar producto…"
              style="flex:1;min-width:160px"
              oninput="window._almBuscar(this.value)">
            <select id="alm-filtro-estado" onchange="window._almFiltroEstado(this.value)"
              style="padding:10px 14px;border:1.5px solid var(--linea);border-radius:10px;background:var(--papel);font-family:inherit;font-size:.93rem;color:var(--tinta)">
              <option value="activo">Solo activos</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <div id="alm-lista-productos"></div>
        </div>
      </div>
    </div>

    <!-- PANEL: movimientos de stock -->
    <div class="app-panel" id="panel-alm-movimientos">
      <h2>Movimientos de stock</h2>
      <p class="sub" style="margin-bottom:24px">Registra entradas y salidas. El stock se actualiza solo. Los movimientos son inmutables: si te equivocas, haz uno inverso.</p>

      <div class="grid-app">
        <div class="tarjeta">
          <h3>Nuevo movimiento</h3>
          <div class="campo-grupo">
            <label for="mov-producto">Producto</label>
            <select id="mov-producto"></select>
          </div>
          <div class="campo-grupo">
            <label for="mov-tipo">Tipo</label>
            <select id="mov-tipo">
              <option value="entrada">📦 Entrada (suma stock)</option>
              <option value="salida">📤 Salida (resta stock)</option>
            </select>
          </div>
          <div class="campo-grupo">
            <label for="mov-cantidad">Cantidad</label>
            <input type="number" id="mov-cantidad" min="1" value="1" placeholder="1">
          </div>
          <div class="campo-grupo">
            <label for="mov-motivo">Motivo (opcional)</label>
            <input type="text" id="mov-motivo" placeholder="Ej.: Pedido proveedor · Consumo interno">
          </div>
          <p class="aviso-resv" id="alm-aviso-mov"></p>
          <button class="btn btn-primario btn-bloque" onclick="window._almRegistrarMov()">Registrar movimiento</button>
        </div>

        <div class="tarjeta">
          <h3>Historial</h3>
          <div class="campo-grupo" style="margin-bottom:14px">
            <select id="mov-filtro-producto" onchange="window._almRenderMovimientos()"
              style="width:100%;padding:10px 14px;border:1.5px solid var(--linea);border-radius:10px;background:var(--papel);font-family:inherit;font-size:.93rem;color:var(--tinta)">
              <option value="">Todos los productos</option>
            </select>
          </div>
          <div id="alm-historial"></div>
        </div>
      </div>
    </div>

  `;
}

/* =====================================================
   CSS ADICIONAL (solo lo específico del módulo)
   ===================================================== */
function inyectarCSS() {
  if (document.getElementById('alm-css')) return;
  const style = document.createElement('style');
  style.id = 'alm-css';
  style.textContent = `
    .alm-producto {
      background:var(--blanco);border:1px solid var(--linea);
      border-radius:var(--radio);padding:18px 20px;
      display:flex;align-items:flex-start;gap:14px;
      transition:box-shadow .2s;
    }
    .alm-producto:hover { box-shadow:var(--sombra); }
    .alm-producto + .alm-producto { margin-top:10px; }
    .alm-producto.inactivo { opacity:.55; }
    .alm-stock-badge {
      font-family:'Inter',monospace;font-weight:700;font-size:1.1rem;
      min-width:52px;text-align:center;padding:8px 6px;
      border-radius:10px;flex-shrink:0;
    }
    .alm-stock-ok { background:var(--verde-claro);color:var(--verde-fiscal); }
    .alm-stock-critico { background:#FBEFD8;color:#A9701A; }
    .alm-stock-cero { background:#FBEAE5;color:var(--sello); }
    .alm-info { flex:1;min-width:0; }
    .alm-info strong { display:block;font-size:.98rem;margin-bottom:2px; }
    .alm-info p { font-size:.86rem;color:var(--tinta-suave);margin:0; }
    .alm-acciones { display:flex;gap:6px;flex-wrap:wrap;align-items:center; }
    .mov-fila {
      display:flex;align-items:center;gap:12px;flex-wrap:wrap;
      padding:11px 0;border-bottom:1px dashed var(--linea);font-size:.88rem;
    }
    .mov-fila:last-child { border-bottom:none; }
    .mov-tipo { font-weight:700;min-width:16px;font-size:1rem; }
    .mov-info { flex:1;min-width:120px; }
    .mov-cantidad { font-family:'Inter',monospace;font-weight:600;min-width:36px;text-align:right; }
    @media (max-width:900px) {
      #alm-grid-panel { grid-template-columns:1fr !important; }
    }
  `;
  document.head.appendChild(style);
}

/* =====================================================
   NAVEGACIÓN ENTRE PANELES DEL MÓDULO
   ===================================================== */
function cambiarPanelAlmacen(nombre) {
  document.querySelectorAll('.app-tab').forEach(t =>
    t.classList.toggle('activo', t.dataset.panel === nombre)
  );
  document.querySelectorAll('.app-panel').forEach(p =>
    p.classList.toggle('activo', p.id === 'panel-' + nombre)
  );
  document.querySelector('.app-cuerpo').scrollTop = 0;

  if (nombre === 'alm-panel') renderPanel();
  if (nombre === 'alm-catalogo') renderCatalogo();
  if (nombre === 'alm-movimientos') renderMovimientos();
}

/* =====================================================
   RENDER PANEL (resumen)
   ===================================================== */
function renderPanel() {
  const activos = productos.filter(p => p.activo);
  const totalStock = activos.reduce((s, p) => s + p.stock, 0);
  const criticos = activos.filter(p => p.stock <= 5).sort((a, b) => a.stock - b.stock);
  const sinStock = activos.filter(p => p.stock === 0).length;

  document.getElementById('alm-metricas').innerHTML = `
    <div class="metrica destacada"><div class="num">${activos.length}</div><div class="lbl">Productos activos</div></div>
    <div class="metrica"><div class="num">${totalStock.toLocaleString('es-ES')}</div><div class="lbl">Unidades en stock</div></div>
    <div class="metrica" style="${criticos.length ? 'border-color:#A9701A;background:#FBEFD8' : ''}">
      <div class="num" style="${criticos.length ? 'color:#A9701A' : ''}">${criticos.length}</div>
      <div class="lbl">Stock crítico (≤5)</div>
    </div>
    <div class="metrica" style="${sinStock ? 'border-color:var(--sello);background:#FBEAE5' : ''}">
      <div class="num" style="${sinStock ? 'color:var(--sello)' : ''}">${sinStock}</div>
      <div class="lbl">Sin stock</div>
    </div>`;

  // Críticos
  const contCrit = document.getElementById('alm-criticos');
  contCrit.innerHTML = criticos.length
    ? criticos.map(p => `
        <div class="mov-fila">
          <span class="alm-stock-badge ${p.stock === 0 ? 'alm-stock-cero' : 'alm-stock-critico'}">${p.stock}</span>
          <span class="mov-info"><strong>${esc(p.nombre)}</strong>
            <span style="display:block;font-size:.8rem;color:var(--tinta-suave)">${esc(p.descripcion || '')}</span>
          </span>
          <button class="btn-mini ok" onclick="window._almAbrirMovDesde('${p.id}','entrada')">+ Entrada</button>
        </div>`).join('')
    : '<p class="vacio" style="padding:14px 0">Sin productos en stock crítico 🎉</p>';

  // Últimos movimientos
  const ultimos = movimientos.slice(0, 12);
  const contMov = document.getElementById('alm-ultimos-mov');
  contMov.innerHTML = ultimos.length
    ? ultimos.map(m => filaMovimiento(m)).join('')
    : '<p class="vacio" style="padding:14px 0">Sin movimientos registrados todavía.</p>';
}

/* =====================================================
   RENDER CATÁLOGO
   ===================================================== */
function renderCatalogo() {
  const busq = filtroBusqueda.toLowerCase();
  const lista = productos
    .filter(p => {
      if (filtroEstado === 'activo' && !p.activo) return false;
      if (busq && !p.nombre.toLowerCase().includes(busq) && !(p.descripcion || '').toLowerCase().includes(busq)) return false;
      return true;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const cont = document.getElementById('alm-lista-productos');
  cont.innerHTML = lista.length
    ? lista.map(p => tarjetaProducto(p)).join('')
    : '<div class="tarjeta vacio">No hay productos que coincidan.</div>';

  // Actualizar select del formulario de movimientos
  actualizarSelectProductos();
}

function tarjetaProducto(p) {
  if (p.id === productoEditandoId) return tarjetaEdicion(p);

  const badgeClass = p.stock === 0 ? 'alm-stock-cero' : p.stock <= 5 ? 'alm-stock-critico' : 'alm-stock-ok';
  return `
    <div class="alm-producto${p.activo ? '' : ' inactivo'}">
      <div class="alm-stock-badge ${badgeClass}" title="Stock actual">${p.stock}</div>
      <div class="alm-info">
        <strong>${esc(p.nombre)}${p.activo ? '' : ' <span style="font-size:.74rem;font-weight:600;color:var(--tinta-suave)">[inactivo]</span>'}</strong>
        <p>${esc(p.descripcion || '—')}</p>
      </div>
      <div class="alm-acciones">
        <button class="btn-mini ok" onclick="window._almAbrirMovDesde('${p.id}','entrada')">+ Entrada</button>
        <button class="btn-mini peligro" onclick="window._almAbrirMovDesde('${p.id}','salida')">− Salida</button>
        <button class="btn-mini" onclick="window._almEditar('${p.id}')">✎ Editar</button>
        <button class="btn-mini ${p.activo ? 'peligro' : 'ok'}" onclick="window._almToggleActivo('${p.id}',${!p.activo})">
          ${p.activo ? 'Desactivar' : 'Activar'}
        </button>
      </div>
    </div>`;
}

function tarjetaEdicion(p) {
  return `
    <div class="alm-producto" style="flex-direction:column;gap:12px">
      <strong style="font-size:.95rem">Editar producto</strong>
      <div class="campo-grupo" style="margin-bottom:0">
        <label for="edit-alm-nombre">Nombre *</label>
        <input type="text" id="edit-alm-nombre" value="${esc(p.nombre)}">
      </div>
      <div class="campo-grupo" style="margin-bottom:0">
        <label for="edit-alm-descripcion">Descripción</label>
        <textarea id="edit-alm-descripcion" style="min-height:60px;resize:vertical">${esc(p.descripcion || '')}</textarea>
      </div>
      <p class="aviso-resv" id="edit-alm-aviso"></p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primario" style="flex:1" onclick="window._almGuardarEdicion('${p.id}')">Guardar cambios</button>
        <button class="btn btn-fantasma" onclick="window._almCancelarEdicion()">Cancelar</button>
      </div>
    </div>`;
}

/* =====================================================
   RENDER MOVIMIENTOS
   ===================================================== */
function renderMovimientos() {
  // Poblar filtro de producto
  const sel = document.getElementById('mov-filtro-producto');
  if (sel) {
    const valorActual = sel.value;
    sel.innerHTML = '<option value="">Todos los productos</option>'
      + productos.filter(p => p.activo).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    sel.value = valorActual;
  }
  renderHistorial();
}

function renderHistorial() {
  const filtroP = document.getElementById('mov-filtro-producto')?.value || '';
  const lista = movimientos
    .filter(m => !filtroP || m.producto_id === filtroP)
    .slice(0, 60);

  const cont = document.getElementById('alm-historial');
  if (!cont) return;
  cont.innerHTML = lista.length
    ? lista.map(m => filaMovimiento(m)).join('')
    : '<p class="vacio" style="padding:14px 0">Sin movimientos para este producto.</p>';
}

function filaMovimiento(m) {
  const prod = productos.find(p => p.id === m.producto_id);
  const fecha = new Date(m.creado_en).toLocaleDateString('es-ES', { day:'numeric', month:'short', year:'numeric' });
  const hora = new Date(m.creado_en).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
  const esEntrada = m.tipo === 'entrada';
  return `
    <div class="mov-fila">
      <span class="mov-tipo" style="color:${esEntrada ? 'var(--verde-fiscal)' : 'var(--sello)'}">${esEntrada ? '▲' : '▼'}</span>
      <span class="mov-info">
        <strong style="font-size:.9rem">${esc(prod ? prod.nombre : '—')}</strong>
        <span style="display:block;font-size:.79rem;color:var(--tinta-suave)">${fecha} · ${hora}${m.motivo ? ' · ' + esc(m.motivo) : ''}</span>
      </span>
      <span class="mov-cantidad" style="color:${esEntrada ? 'var(--verde-fiscal)' : 'var(--sello)'}">
        ${esEntrada ? '+' : '−'}${m.cantidad}
      </span>
    </div>`;
}

/* =====================================================
   ACCIONES — CRUD PRODUCTOS
   ===================================================== */
async function guardarProducto() {
  const aviso = document.getElementById('alm-aviso-form');
  const nombre = document.getElementById('alm-nombre').value.trim();
  const descripcion = document.getElementById('alm-descripcion').value.trim();
  const stockInicial = Math.max(0, parseInt(document.getElementById('alm-stock-inicial').value, 10) || 0);

  if (!nombre) {
    aviso.className = 'aviso-resv error'; aviso.textContent = 'El nombre no puede quedar vacío.'; return;
  }

  const sb = window.supabase;
  const clinicaId = window.usuarioActual.clinicaId;

  const { data: nuevo, error } = await sb
    .from('productos')
    .insert({ clinica_id: clinicaId, nombre, descripcion, stock: stockInicial })
    .select()
    .single();

  if (error) {
    aviso.className = 'aviso-resv error';
    aviso.textContent = 'No se ha podido guardar el producto.';
    console.error(error); return;
  }

  // Si hay stock inicial, registrar el movimiento de entrada
  if (stockInicial > 0) {
    await sb.from('movimientos_stock').insert({
      clinica_id: clinicaId,
      producto_id: nuevo.id,
      trabajador_id: window.usuarioActual.id,
      tipo: 'entrada',
      cantidad: stockInicial,
      motivo: 'Stock inicial',
    });
    movimientos.unshift({ ...nuevo, tipo: 'entrada', cantidad: stockInicial, producto_id: nuevo.id, creado_en: nuevo.creado_en });
  }

  productos.push(nuevo);
  productos.sort((a, b) => a.nombre.localeCompare(b.nombre));

  aviso.className = 'aviso-resv ok'; aviso.textContent = '✓ Producto guardado.';
  document.getElementById('alm-nombre').value = '';
  document.getElementById('alm-descripcion').value = '';
  document.getElementById('alm-stock-inicial').value = '0';
  renderCatalogo();
}

async function guardarEdicionProducto(id) {
  const aviso = document.getElementById('edit-alm-aviso');
  const nombre = document.getElementById('edit-alm-nombre').value.trim();
  const descripcion = document.getElementById('edit-alm-descripcion').value.trim();

  if (!nombre) {
    aviso.className = 'aviso-resv error'; aviso.textContent = 'El nombre no puede quedar vacío.'; return;
  }

  const { data: actualizado, error } = await window.supabase
    .from('productos')
    .update({ nombre, descripcion })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    aviso.className = 'aviso-resv error'; aviso.textContent = 'No se han podido guardar los cambios.';
    console.error(error); return;
  }

  const idx = productos.findIndex(p => p.id === id);
  if (idx !== -1) productos[idx] = actualizado;
  productoEditandoId = null;
  renderCatalogo();
}

async function toggleActivo(id, nuevoEstado) {
  const { data: actualizado, error } = await window.supabase
    .from('productos')
    .update({ activo: nuevoEstado })
    .eq('id', id)
    .select()
    .single();

  if (error) { console.error(error); return; }

  const idx = productos.findIndex(p => p.id === id);
  if (idx !== -1) productos[idx] = actualizado;
  renderCatalogo();
  renderPanel();
}

/* =====================================================
   ACCIONES — MOVIMIENTOS
   ===================================================== */
async function registrarMovimiento() {
  const aviso = document.getElementById('alm-aviso-mov');
  const productoId = document.getElementById('mov-producto').value;
  const tipo = document.getElementById('mov-tipo').value;
  const cantidad = parseInt(document.getElementById('mov-cantidad').value, 10);
  const motivo = document.getElementById('mov-motivo').value.trim();

  if (!productoId) { aviso.className = 'aviso-resv error'; aviso.textContent = 'Elige un producto.'; return; }
  if (!cantidad || cantidad < 1) { aviso.className = 'aviso-resv error'; aviso.textContent = 'La cantidad debe ser mayor que 0.'; return; }

  const producto = productos.find(p => p.id === productoId);
  if (!producto) return;

  if (tipo === 'salida' && producto.stock < cantidad) {
    aviso.className = 'aviso-resv error';
    aviso.textContent = `Stock insuficiente: solo hay ${producto.stock} unidad${producto.stock === 1 ? '' : 'es'} disponibles.`;
    return;
  }

  const sb = window.supabase;
  const clinicaId = window.usuarioActual.clinicaId;
  const nuevoStock = tipo === 'entrada' ? producto.stock + cantidad : producto.stock - cantidad;

  // Insertar movimiento y actualizar stock en una transacción secuencial
  const { data: mov, error: errMov } = await sb
    .from('movimientos_stock')
    .insert({
      clinica_id: clinicaId,
      producto_id: productoId,
      trabajador_id: window.usuarioActual.id,
      tipo, cantidad, motivo,
    })
    .select()
    .single();

  if (errMov) {
    aviso.className = 'aviso-resv error'; aviso.textContent = 'No se ha podido registrar el movimiento.';
    console.error(errMov); return;
  }

  const { data: prodActualizado, error: errProd } = await sb
    .from('productos')
    .update({ stock: nuevoStock })
    .eq('id', productoId)
    .select()
    .single();

  if (errProd) {
    aviso.className = 'aviso-resv error'; aviso.textContent = 'Movimiento registrado pero el stock no se ha podido actualizar. Recarga la página.';
    console.error(errProd); return;
  }

  movimientos.unshift(mov);
  const idx = productos.findIndex(p => p.id === productoId);
  if (idx !== -1) productos[idx] = prodActualizado;

  aviso.className = 'aviso-resv ok';
  aviso.textContent = `✓ Movimiento registrado. Stock de "${producto.nombre}": ${nuevoStock} uds.`;

  document.getElementById('mov-cantidad').value = '1';
  document.getElementById('mov-motivo').value = '';
  renderHistorial();
  renderCatalogo();
  renderPanel();
}

/* =====================================================
   HELPERS
   ===================================================== */
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function actualizarSelectProductos() {
  const sel = document.getElementById('mov-producto');
  if (!sel) return;
  sel.innerHTML = productos
    .filter(p => p.activo)
    .map(p => `<option value="${p.id}">${esc(p.nombre)} (stock: ${p.stock})</option>`)
    .join('') || '<option value="">Sin productos activos</option>';
}

function renderTodo() {
  renderPanel();
  renderCatalogo();
  renderMovimientos();
}

/* =====================================================
   EVENTOS (expuestos en window para los onclick inline)
   ===================================================== */
function bindEventos() {
  window._almGuardar = guardarProducto;
  window._almCancelar = () => {
    productoEditandoId = null;
    document.getElementById('alm-form-titulo').textContent = 'Nuevo producto';
    document.getElementById('alm-btn-cancelar').style.display = 'none';
    document.getElementById('alm-nombre').value = '';
    document.getElementById('alm-descripcion').value = '';
    document.getElementById('alm-stock-inicial').value = '0';
    document.getElementById('alm-aviso-form').className = 'aviso-resv';
  };
  window._almEditar = id => {
    productoEditandoId = id;
    renderCatalogo();
  };
  window._almGuardarEdicion = guardarEdicionProducto;
  window._almCancelarEdicion = () => { productoEditandoId = null; renderCatalogo(); };
  window._almToggleActivo = toggleActivo;
  window._almBuscar = val => { filtroBusqueda = val; renderCatalogo(); };
  window._almFiltroEstado = val => { filtroEstado = val; renderCatalogo(); };
  window._almRegistrarMov = registrarMovimiento;
  window._almRenderMovimientos = renderHistorial;
  window._almAbrirMovDesde = (productoId, tipo) => {
    cambiarPanelAlmacen('alm-movimientos');
    setTimeout(() => {
      const sel = document.getElementById('mov-producto');
      if (sel) sel.value = productoId;
      const selTipo = document.getElementById('mov-tipo');
      if (selTipo) selTipo.value = tipo;
      document.getElementById('mov-cantidad').focus();
    }, 50);
  };
}